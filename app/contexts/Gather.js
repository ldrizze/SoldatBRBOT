const Context = require('../classes/Context')
const Command = require('../classes/Command')
const Logger = require('../classes/Logger')
const GatherServers = require('../repositories/GatherServers')
const GatherSessions = require('../repositories/GatherSessions')
const ServerTokens = require('../repositories/ServerTokens')
const Users = require('../repositories/Users')
const { MD } = require('../classes/Responses')
const config = require('../config')

module.exports = class Gather extends Context {
  constructor (user, channel, message) {
    super(user, channel, message)
    this.commands = [
      new Command('breathe', ['server'], this._breathe.bind(this)),
      new Command('genservertoken', ['gatheradmin'], this._genServerToken.bind(this)),
      new Command('addctf', ['everyone'], this._addCTF.bind(this)),
      new Command('del', ['everyone'], this._remove.bind(this)),
      new Command('round', ['server'], this._round.bind(this)),
      new Command('playerauth', ['server'], this._playerauth.bind(this)),
      new Command('checkplayerauth', ['server'], this._checkPlayerAuth.bind(this)),
      new Command('serverready', ['server'], this._serverReady.bind(this)),
      new Command('info', ['everyone'], this._info.bind(this))
    ]
    this.log = new Logger('Gather')
    this.gatherRepository = new GatherServers()
    this.gatherSessionsRepository = new GatherSessions()
    this.serverTokensRepository = new ServerTokens()
    this.usersRepository = new Users()
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
      const isPlayerInSession = await this.gatherRepository.findPlayerSession(this.user)
      if (isPlayerInSession) return 'Você já está em uma fila.'
      session.players.push(this.user)
      await this.gatherRepository.addPlayer(session.ip, session.port, this.user)

      if (session.players.length === config.game.maxplayers) {
        // TODO start the game
        const sessionId = await this.gatherRepository.startGame(session.ip, session.port)
        const players = session.players.slice()
        this._shuffleTeams(players)
        const alpha = players.slice(0, config.game.alpha)
        const bravo = players.slice(-1 * config.game.bravo)
        await this.gatherSessionsRepository.create(
          sessionId, alpha, bravo
        )
        return 'O jogo já está pronto, estamos preparando o servidor. ' +
        'Um invite para jogar será enviado via mensagem direta.\n' +
        'Time Alpha: [' +
        (
          alpha.map(value => `<@${value}>`).join(',')
        ) + ']\n' +
        'Time Bravo: [' +
        (
          bravo.map(value => `<@${value}>`).join(',')
        ) + ']'
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
    const token = await this.serverTokensRepository.generate(config.roles.server)
    return new MD(token)
  }

  async _playerauth () {
    const [, ip, port, pin, steamId] = this.params

    // check if server exists
    const server = await this.gatherRepository.find(ip, port)
    if (server && server.sessionId) {
      const users = await this.usersRepository.get({
        userId: { $in: server.players },
        pin
      })
      if (users && users.length === 1) {
        const user = users[0]

        return String(+(await this.usersRepository.authenticate(user.userId, pin, steamId)))
      }
    }

    return '0'
  }

  async _checkPlayerAuth () {
    const [, steamId] = this.params
    const user = await this.usersRepository.findBySteamId(steamId)
    return user ? '1' : '0'
  }

  async _serverReady () {
    const [, ip, port, password] = this.params
    if (!this.botClient) return
    const guildClient = this.botClient.guilds.cache.get(config.discordServerId)
    if (!guildClient) return
    const server = await this.gatherRepository.find(ip, port)
    let pinIndex = 1
    let pin = null
    if (server) {
      for (const userId of server.players) {
        const user = await this.usersRepository.find(userId)
        if (user) { // user exists
          if (!user.auth) { // not auth, need generate pin
            pin = this._generatePin(100 * pinIndex++)
            await this.usersRepository.newPin(userId, pin)
          }
        } else { // create user
          pin = this._generatePin(100 * pinIndex++)
          await this.usersRepository.create(userId, pin)
        }

        let message = `Server: soldat://${ip}:${port}/${password}`
        if (pin) message += `\n Pin: ${pin}`
        const userClient = guildClient.members.cache.get(userId)
        if (userClient) userClient.send(message)
      }
      await this.gatherRepository.changeState(ip, port, 'running')
    }
  }

  async _round () {
    const [, ip, port, map, alphaScore, bravoScore, ..._playerScores] = this.params
    const server = await this.gatherRepository.find(ip, port)
    if (server && server.sessionId) {
      const players = server.players.slice()
      const session = await this.gatherSessionsRepository.find(server.sessionId)
      const team = session.rounds === 0 ? 'alpha' : 'bravo'
      session.rounds++
      if (session) {
        const playerScores = _playerScores.map(score => {
          const [steamId, k, d] = score.split('|')
          return { k, d, steamId }
        })

        await this.gatherSessionsRepository.insertScores(
          server.sessionId,
          team,
          map,
          { alpha: alphaScore, bravo: bravoScore },
          session.rounds,
          playerScores
        )

        if (session.rounds === config.game.rounds) {
          // Tiebreak or endGame
          session.ended = true
          await this.gatherRepository.endGame(ip, port)
        } else if (session.rounds === config.game.rounds + 1) {
          // TODO Tiebreak round
        }

        if (session.ended) { // Send BOT endgame message
          if (this.botClient) {
            if (!this.botClient) return
            const guildClient = this.botClient.guilds.cache.get(config.discordServerId)
            if (!guildClient) return
            const scores = this._compondScores(session)
            guildClient.channels.cache.get(config.channels.gather).send(
              `Jogo do servidor ${server.name}\n` +
              `Alpha Score: ${scores[0]}\n` +
              `Bravo Score: ${scores[1]}\n` +
              (
                players.map(value => `<@${value}> `).join(',')
              ) + ' GG!'
            )
          }
        }
      }

      return '1'
    }
  }

  async _info (event) {
    const servers = await this.gatherRepository.allNotOffline()
    if (servers.length > 0) {
      const serversSummary = servers.map(server => {
        return `${server.name}\n` +
        `Status: ${server.state}\n` +
        'Jogadores: [' +
        (
          server.players.map(player => {
            const member = event.guild.members.cache.get(player)
            return member.nickname || member.user.username
          }).join(', ')
        ) + ']'
      })
      event.channel.send(serversSummary)
    }
  }

  _generatePin (plus) {
    return plus + Math.floor(Math.random() * 99)
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

  _compondScores (session) {
    const alpha =
      (+session.maps.alpha.score.alpha) +
      (+session.maps.bravo.score.alpha) +
      (+session.maps.tie.score.alpha)
    const bravo =
      (+session.maps.alpha.score.bravo) +
      (+session.maps.bravo.score.bravo) +
      (+session.maps.tie.score.bravo)
    return [alpha, bravo]
  }
}
