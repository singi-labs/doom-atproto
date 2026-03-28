/**
 * Doom over AT Protocol -- Player Client
 *
 * Captures keyboard input, writes input records to AT Protocol,
 * subscribes to frame records from the game server, renders to canvas.
 */
import { loadConfig } from './config.js'

const config = loadConfig()

console.log('Doom AT Protocol Client')
console.log(`  PDS: ${config.ATP_SERVICE}`)
console.log(`  Server: ${config.SERVER_DID}`)
console.log()
console.log('Client scaffolding ready. Browser UI coming in Phase 1.')
