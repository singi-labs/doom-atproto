/**
 * Doom over AT Protocol -- Game Server
 *
 * Reads player input records from AT Protocol,
 * runs the Doom engine tick-by-tick via WASM,
 * writes rendered frame records back.
 */
import { loadConfig } from './config.js'

const config = loadConfig()

console.log('Doom AT Protocol Server')
console.log(`  PDS: ${config.ATP_SERVICE}`)
console.log(`  Player: ${config.PLAYER_DID}`)
console.log(`  WAD: ${config.WAD_PATH}`)
console.log()
console.log('Server scaffolding ready. WASM integration coming in Phase 1.')
