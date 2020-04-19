## Git API server for the Remix LearnEth Plugin

The plugin is here: https://github.com/bunsenstraat/remix-learneth-plugin
It needs an API to clone git repositories so it can scan them and return the structure of the repo to be used in a list.

### requirements
- redis
- node >10

It is uses the default system temp directory to clone the repo's. 

### config

config.json holds a whitelist of allowed urls, this is by default the REMIX IDE client

### build

run npm build
use pm2 to start
