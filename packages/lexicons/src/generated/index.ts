/**
 * GENERATED CODE - DO NOT MODIFY
 */
import {
  type Auth,
  type Options as XrpcOptions,
  Server as XrpcServer,
  type StreamConfigOrHandler,
  type MethodConfigOrHandler,
  createServer as createXrpcServer,
} from '@atproto/xrpc-server'
import { schemas } from './lexicons.js'

export const DEV_SINGI_DOOM = {
  DefsEncodingPng: 'dev.singi.doom.defs#encodingPng',
  DefsEncodingPaletteRle: 'dev.singi.doom.defs#encodingPaletteRle',
  SessionActive: 'dev.singi.doom.session#active',
  SessionPaused: 'dev.singi.doom.session#paused',
  SessionEnded: 'dev.singi.doom.session#ended',
}

export function createServer(options?: XrpcOptions): Server {
  return new Server(options)
}

export class Server {
  xrpc: XrpcServer
  com: ComNS
  dev: DevNS

  constructor(options?: XrpcOptions) {
    this.xrpc = createXrpcServer(schemas, options)
    this.com = new ComNS(this)
    this.dev = new DevNS(this)
  }
}

export class ComNS {
  _server: Server
  atproto: ComAtprotoNS

  constructor(server: Server) {
    this._server = server
    this.atproto = new ComAtprotoNS(server)
  }
}

export class ComAtprotoNS {
  _server: Server
  repo: ComAtprotoRepoNS

  constructor(server: Server) {
    this._server = server
    this.repo = new ComAtprotoRepoNS(server)
  }
}

export class ComAtprotoRepoNS {
  _server: Server

  constructor(server: Server) {
    this._server = server
  }
}

export class DevNS {
  _server: Server
  singi: DevSingiNS

  constructor(server: Server) {
    this._server = server
    this.singi = new DevSingiNS(server)
  }
}

export class DevSingiNS {
  _server: Server
  doom: DevSingiDoomNS

  constructor(server: Server) {
    this._server = server
    this.doom = new DevSingiDoomNS(server)
  }
}

export class DevSingiDoomNS {
  _server: Server

  constructor(server: Server) {
    this._server = server
  }
}
