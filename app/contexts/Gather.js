const Context = require('../classes/Context')
const Command = require('../classes/Command')
const Logger = require('../classes/Logger')
const GatherServers = require('../repositories/GatherServers')
const GatherSessions = require('../repositories/GatherSessions')
const ServerTokens = require('../repositories/ServerTokens')
const { MD } = require('../classes/Responses')
const config = require('../config')

module.exports = class Gather extends Context {
  constructor (user, channel, message) {
    super(user, channel, message)
    this.commands = [
      new Command('breathe', ['server'], this._breathe.bind(this)),
      new Command('genservertoken', ['gatheradmin'], this._genServerToken.bind(this)),
      new Command('addctf', ['everyone'], this._addCTF.bind(this)),
      new Command('remove', ['everyone'], this._remove.bind(this))
    ]
    this.log = new Logger('Gather')
    this.gatherRepository = new GatherServers()
    this.gatherSessionsRepository = new GatherSessions()
    this.serverTokensRepository = new ServerTokens()
    this.params = message.split(' ')
  }

  async validate (roles) {
    const command = this._validateCommands()
    this.log.d('Validated command', command)

    if (command) {
      const normalizedRoles = this._normalizeRoles(roles)
      this.log.d('normalizedRoles', normalizedRoles)
      if (this._validateCommandRoles(command, normalizedRoles)) {
        if (this.channel === config.channels.gather) return command
      }
    }
  }

  async _addServer (type) {
    let [, ip, port, ...name] = this.params
    name = name.join(' ')
    const result = await this.gatherRepository.create(ip, port, name, type, 'waiting')
    return result.ops[0]
  }

  async _removeServer () {
    if (this.params.length === 3) {
      const [, ip, port] = this.params
      await this.gatherRepository.delete(ip, port)
      return `Servidor ${ip}:${port} removido com sucesso`
    }
  }

  async _breathe () {
    if (this.params.length >= 4) {
      let [, ip, port, type, ...name] = this.params
      name = name.join(' ')
      let session = await this.gatherRepository.find(ip, port)
      if (!session) { // If server was not created
        session = await this._addServer(type)
      } else if (session.state === 'offline') {
        await this.gatherRepository.changeState(
          ip, port, 'waiting'
        )
      } else if (session.name !== name) {
        await this.gatherRepository.changeName(ip, port, name)
      } else {
        await this.gatherRepository.hearthBeat(ip, port)
      }
      return session.state
    }
  }

  async _addCTF () {
    const availableSessions = await this.gatherRepository.available()
    if (availableSessions.length > 0) {
      const session = availableSessions[0]
      session.players.push(this.user)
      await this.gatherRepository.addPlayer(session.ip, session.port, this.user)

      if (session.players.length === config.game.maxplayers) {
        // TODO start the game
        const sessionId = await this.gatherRepository.startGame(session.ip, session.port)
        const players = session.players.slice()
        this._shuffleTeams(players)
        await this.gatherSessionsRepository.create(sessionId, players.slice(0, 3), players.slice(-3))
        return 'O jogo já está pronto, estamos preparando o servidor.' +
        'Um invite para jogar será enviado via mensagem direta. ' +
        (
          players.reduce((previous, current) =>
            ((typeof previous === 'string' ? previous : `<#${previous}> `) + `<#${current}> `)
          )
        )
      } else {
        return `Adicionado a fila do server ${session.name}`
      }
    } else {
      return 'Não há nenhum servidor com vaga no momento. Digite !info para obter a lista de servidores'
    }
  }

  async _remove () {
    const session = await this.gatherRepository.findPlayerSession(this.user)
    if (session && session.state === 'waiting') {
      await this.gatherRepository.removePlayer(session.ip, session.port, this.user)
      return 'Removido com sucesso.'
    } else {
      return 'Você não está em uma fila de espera.'
    }
  }

  async _genServerToken () {
    const token = await this.serverTokensRepository.generate('server')
    return new MD(token)
  }

  // Help methods
  _shuffleTeams (players) {
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const x = players[i]
      players[i] = players[j]
      players[j] = x
    }
    return players
  }
}