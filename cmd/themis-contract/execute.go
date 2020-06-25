package main

import (
	"os"

	contract "github.com/informalsystems/themis-contract/pkg/themis-contract"
	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
)

func executeCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "execute [contract]",
		Short: "Shortcut to sign and compile a contract",
		Long: `Provides a simple shortcut to sign and compile a contract. If the output 
contract is stored in the same Git repository as the contract itself, Themis
Contract will automatically try to commit and push the act of signing and the
newly compiled contract.`,
		Run: func(cmd *cobra.Command, args []string) {
			contractPath := defaultContractPath
			if len(args) > 0 {
				contractPath = args[0]
			}
			c, err := contract.Load(contractPath, globalCtx)
			if err != nil {
				log.Error().Msgf("Failed to load contract: %s", err)
				os.Exit(1)
			}
			// we sign and commit but ensure we don't push yet
			err = c.Sign(flagSigId, globalCtx.WithAutoPush(false))
			if err != nil {
				log.Error().Msgf("Failed to sign contract: %s", err)
				os.Exit(1)
			}
			err = c.CompileCommitAndPush(flagOutput, globalCtx)
			if err != nil {
				log.Error().Msgf("Failed to compile contract: %s", err)
				os.Exit(1)
			}
		},
	}
	cmd.PersistentFlags().StringVar(&flagSigId, "as", "", "the ID of the signatory on behalf of whom you want to sign")
	cmd.PersistentFlags().StringVarP(&flagOutput, "output", "o", "contract.pdf", "where to write the output contract")
	return cmd
}
