/* eslint-disable no-await-in-loop */
import * as path from 'path'
import { ContractFormatError, SignatoryMissingFieldError, CounterpartyMissingFieldError, DBError } from './errors'
import { ensurePath, dirExistsAsync, readdirAsync, fileExistsAsync, unlinkAsync } from './async-io'
import { logger } from './logging'
import { writeTOMLFileAsync, readTOMLFileAsync } from './toml'
import { fullSigImageName, initialsImageName } from './template-helpers'

const extractParams = (a: any, skipFields?: string[]): any => {
  const additionalParams: any = {}
  for (const fieldName in a) {
    if (Object.prototype.hasOwnProperty.call(a, fieldName)) {
      if (!skipFields || skipFields.indexOf(fieldName) === -1) {
        additionalParams[fieldName] = a[fieldName]
      }
    }
  }
  return additionalParams
}

const mergeParams = (a: any, b: any): any => {
  for (const fieldName in b) {
    if (Object.prototype.hasOwnProperty.call(b, fieldName)) {
      a[fieldName] = b[fieldName]
    }
  }
  return a
}

export class Signatory {
  id: string

  fullNames: string

  keybaseId?: string

  additionalParams: any = {}

  constructor(id: string, fullNames: string, keybaseId?: string, additionalParams?: any) {
    this.id = id
    this.fullNames = fullNames
    this.keybaseId = keybaseId
    this.additionalParams = additionalParams ? additionalParams : this.additionalParams
  }

  toDB(): any {
    return mergeParams({
      full_names: this.fullNames,
      keybase_id: this.keybaseId,
    }, this.additionalParams)
  }

  toTemplateVar(counterparty: Counterparty, sigImages: Map<string, string>): any {
    const sigImage = sigImages.get(fullSigImageName(counterparty.id, this.id))
    const initialsImage = sigImages.get(initialsImageName(counterparty.id, this.id))
    logger.debug(`Signatory additional params:\n${JSON.stringify(this.additionalParams, null, 2)}`)
    return mergeParams({
      counterparty_id: counterparty.id,
      id: this.id,
      full_names: this.fullNames,
      keybase_id: this.keybaseId ? this.keybaseId : null,
      signature_image: sigImage ? sigImage : null,
      initials_image: initialsImage ? initialsImage : null,
    }, this.additionalParams)
  }

  static fromDB(id: string, a: any): Signatory {
    return new Signatory(
      id,
      a.full_names,
      'keybase_id' in a ? a.keybase_id : undefined,
      extractParams(a, ['id', 'full_names', 'keybase_id']),
    )
  }

  static fromContract(counterpartyId: string, signatoryId: string, a: any): Signatory {
    if (!(signatoryId in a)) {
      throw new ContractFormatError(`Missing section for signatory "${signatoryId}" of counterparty "${counterpartyId}"`)
    }
    if (!('full_names' in a[signatoryId])) {
      throw new SignatoryMissingFieldError(counterpartyId, signatoryId, 'full_names')
    }
    let keybaseId: string | undefined
    if ('keybase_id' in a[signatoryId]) {
      keybaseId = a[signatoryId].keybase_id
    }
    return new Signatory(
      signatoryId,
      a[signatoryId].full_names,
      keybaseId,
      extractParams(a[signatoryId], ['id', 'full_names', 'keybase_id']),
    )
  }
}

export class Counterparty {
  /** A unique identifier for this counterparty. */
  id: string

  /** The full name of this counterparty. */
  fullName: string

  /** One or more signatories for this counterparty. */
  signatories = new Map<string, Signatory>()

  /** Any additional parameters added in the contract for this counterparty. */
  additionalParams: any = {}

  constructor(id: string, fullName: string, signatories?: Map<string, Signatory>, additionalParams?: any) {
    this.id = id
    this.fullName = fullName
    if (signatories) {
      this.signatories = signatories
    }
    if (additionalParams) {
      this.additionalParams = additionalParams
    }
  }

  hasSignatory(id: string): boolean {
    return this.signatories.has(id)
  }

  getSignatory(id: string): Signatory | undefined {
    return this.signatories.get(id)
  }

  listSignatories(): Signatory[] {
    const sigs: Signatory[] = []
    this.signatories.forEach(sig => sigs.push(sig))
    return sigs.sort((a, b) => {
      if (a.fullNames < b.fullNames) {
        return -1
      }
      if (a.fullNames > b.fullNames) {
        return 1
      }
      return 0
    })
  }

  setSignatory(id: string, sig: Signatory) {
    this.signatories.set(id, sig)
  }

  async saveToFile(filename: string) {
    await writeTOMLFileAsync(filename, this.toDB())
    logger.debug(`Wrote counterparty "${this.id}" to ${filename}`)
  }

  toDB(): any {
    // we purposefully don't serialize the ID
    const a: any = {
      full_name: this.fullName,
      signatories: new Array<string>(),
    }
    this.signatories.forEach(sig => {
      a.signatories.push(sig.id)
      // add each signatory as a sub-object within the counterparty
      a[sig.id] = sig.toDB()
    })
    return mergeParams(a, this.additionalParams)
  }

  toTemplateVar(sigImages: Map<string, string>): any {
    const signatories: any = {}
    this.signatories.forEach(sig => {
      signatories[sig.id] = sig.toTemplateVar(this, sigImages)
    })
    const tv = mergeParams({
      id: this.id,
      full_name: this.fullName,
      signatories: signatories,
    }, this.additionalParams)
    logger.debug(`Rendered counterparty to template var:\n${JSON.stringify(tv, null, 2)}`)
    return tv
  }

  static fromDB(id: string, a: any): Counterparty {
    const signatories = new Map<string, Signatory>()
    if ('signatories' in a && Array.isArray(a.signatories)) {
      a.signatories.forEach((sid: string) => {
        if (sid in a) {
          signatories.set(sid, Signatory.fromDB(sid, a[sid]))
        } else {
          throw new DBError(`Missing details for signatory with ID "${sid}" in counterparty "${id}"`)
        }
      })
    }
    return new Counterparty(
      id,
      a.full_name,
      signatories,
      extractParams(a, ['id', 'full_name', 'signatories']),
    )
  }

  static fromContract(id: string, a: any): Counterparty {
    if (!(id in a)) {
      throw new ContractFormatError(`Missing section for counterparty "${id}"`)
    }
    if (!('full_name' in a[id])) {
      throw new CounterpartyMissingFieldError(id, 'full_name')
    }
    if (!('signatories' in a[id])) {
      throw new CounterpartyMissingFieldError(id, 'signatories')
    }
    if (!Array.isArray(a[id].signatories)) {
      throw new ContractFormatError(`Expected "signatories" field for counterparty "${id}" to be an array`)
    }
    if (a[id].signatories.length === 0) {
      throw new ContractFormatError(`Expected at least one signatory for counterparty "${id}"`)
    }
    const signatories = new Map<string, Signatory>()
    a[id].signatories.forEach((sigID: string) => signatories.set(sigID, Signatory.fromContract(id, sigID, a)))
    return new Counterparty(
      id,
      a[id].full_name,
      signatories,
      extractParams(a[id], ['id', 'full_name', 'signatories']),
    )
  }

  static async loadFromFile(filename: string): Promise<Counterparty> {
    const parsed = path.parse(filename)
    const id = parsed.name
    logger.debug(`Attempting to load counterparty (ID: "${id}") from file: ${filename}`)
    const v = await readTOMLFileAsync(filename)
    return Counterparty.fromDB(id, v)
  }
}

export class CounterpartyDB {
  // Where this database is located in the filesystem
  private basePath: string

  // A mapping of counterparty IDs to counterparty details.
  private counterparties = new Map<string, Counterparty>()

  constructor(basePath: string) {
    this.basePath = basePath
  }

  async save(c: Counterparty) {
    await c.saveToFile(path.join(this.basePath, `${c.id}.toml`))
    this.counterparties.set(c.id, c)
    logger.info(`Updated counterparty "${c.fullName}" with ID ${c.id}`)
  }

  has(id: string): boolean {
    return this.counterparties.has(id)
  }

  get(id: string): Counterparty | undefined {
    return this.counterparties.get(id)
  }

  async delete(id: string) {
    const c = this.counterparties.get(id)
    if (c) {
      await unlinkAsync(path.join(this.basePath, `${id}.toml`))
      this.counterparties.delete(id)
      logger.info(`Deleted counterparty "${c.fullName}" with ID "${c.id}"`)
    }
  }

  async clear() {
    for (const id of this.counterparties.keys()) {
      await this.delete(id)
    }
  }

  /**
   * Returns a sorted list of counterparties (sorted by their full name).
   * @returns {Counterparty[]} A sorted list of counterparties in this DB.
   */
  all(): Counterparty[] {
    const result: Counterparty[] = []
    this.counterparties.forEach(c => {
      result.push(c)
    })
    return result.sort((a, b) => {
      if (a.fullName < b.fullName) {
        return -1
      }
      if (a.fullName > b.fullName) {
        return 1
      }
      return 0
    })
  }

  static async init(basePath: string): Promise<CounterpartyDB> {
    if (await dirExistsAsync(basePath)) {
      return CounterpartyDB.load(basePath)
    }
    // a fresh new database
    await ensurePath(basePath)
    logger.debug(`Created counterparty database: ${basePath}`)
    return new CounterpartyDB(basePath)
  }

  static async load(basePath: string): Promise<CounterpartyDB> {
    const entries: string[] = await readdirAsync(basePath)
    const db = new CounterpartyDB(basePath)
    for (const entry of entries) {
      const fullPath = path.join(basePath, entry)
      if (await fileExistsAsync(fullPath)) {
        const c = await Counterparty.loadFromFile(fullPath)
        db.counterparties.set(c.id, c)
      }
    }
    logger.debug(`Loaded ${db.counterparties.size} counterparties from: ${basePath}`)
    return db
  }
}
