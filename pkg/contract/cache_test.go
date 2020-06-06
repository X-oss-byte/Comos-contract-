package contract_test

import (
	"fmt"
	"net/url"

	"github.com/informalsystems/themis-contract/pkg/contract"
)

type mockCache struct {
	successes map[string]string
	failures  map[string]error
}

var _ contract.Cache = &mockCache{}

func (c *mockCache) FromGit(u *contract.GitURL) (string, error) {
	return c.entry(u.String())
}

func (c *mockCache) FromWeb(u *url.URL) (string, error) {
	return c.entry(u.String())
}

func (c *mockCache) entry(path string) (string, error) {
	if err, _ := c.failures[path]; err != nil {
		return "", err
	}
	path, ok := c.successes[path]
	if !ok {
		return "", fmt.Errorf("missing mock cache entry for %s", path)
	}
	return path, nil
}
