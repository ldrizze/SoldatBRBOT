/*eslint-disable*/
require('dotenv').config()
const { expect } = require('chai')
const { connected, operation } = require('../app/classes/Mongo')
const Gather = require('../app/contexts/Gather')
const config = require('../app/config')

describe('Gahter context unit tests', async () => {
  before(done => {
    connected.then(done)
  })

  it('!breathe', async () => {
    const GatherInstance = new Gather(99, config.channels.gather, '!breathe 127.0.0.1 27015 ctf Gather Test Server #1')
    const command = await GatherInstance.validate([config.roles.server])
    expect(command).be.an('object')
    const result = await command.fn()
    expect(result).be.an('string')
  })

  it('!addctf', async () => {
    const GatherInstance = new Gather(99, config.channels.gather, '!addctf')
    const command = await GatherInstance.validate([config.roles.everyone])
    expect(command).be.an('object')
    const result = await command.fn()
    expect(result).be.an('string')
    expect(result).contains('Adicionado')
  })

  it('!del', async () => {
    const GatherInstance = new Gather(99, config.channels.gather, '!del')
    const command = await GatherInstance.validate([config.roles.everyone])
    expect(command).be.an('object')
    const result = await command.fn()
    expect(result).be.an('string')
    expect(result).contains('Removido')
  })

  it('!breathe a second server', async () => {
    const GatherInstance = new Gather(99, config.channels.gather, '!breathe 127.0.0.1 27016 ctf Gather Test Server #2')
    const command = await GatherInstance.validate([config.roles.server])
    expect(command).be.an('object')
    const result = await command.fn()
    expect(result).be.an('string')
  })

  it('!addctf six persons and start session', async () => {
    for(let i = 1; i <= 6; i++) {
      const GatherInstance = new Gather(99 + i, config.channels.gather, '!addctf')
      const command = await GatherInstance.validate([config.roles.everyone])
      expect(command).be.an('object')
      const result = await command.fn()
      expect(result).be.an('string')

      if (i < 6) expect(result).contains('Adicionado')
      else expect(result).contains('invite')
    }
  })

  it('!genservertoken', async  () => {
    const GatherInstance = new Gather(99, config.channels.gather, '!genservertoken')
    const command = await GatherInstance.validate([config.roles.gatheradmin])
    expect(command).be.an('object')
    const result = await command.fn()
    expect(result).to.match(/((\w|\n){8})-((\w|\n){4})-((\w|\n){4})-((\w|\n){4})-((\w|\n){12})$/g)
  })

  after(done => {
    operation(db => {
      db.collection('gatherServers').deleteMany()
    })

    operation(db => {
      db.collection('gatherSessions').deleteMany()
    })

    operation(db => {
      db.collection('serverTokens').deleteMany()
      done()
    })
  })
})
