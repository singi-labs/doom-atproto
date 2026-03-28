/**
 * GENERATED CODE - DO NOT MODIFY
 */
import {
  type LexiconDoc,
  Lexicons,
  ValidationError,
  type ValidationResult,
} from '@atproto/lexicon'
import { type $Typed, is$typed, maybe$typed } from './util.js'

export const schemaDict = {
  ComAtprotoRepoStrongRef: {
    lexicon: 1,
    id: 'com.atproto.repo.strongRef',
    description: 'A URI with a content-hash fingerprint.',
    defs: {
      main: {
        type: 'object',
        required: ['uri', 'cid'],
        properties: {
          uri: {
            type: 'string',
            format: 'at-uri',
          },
          cid: {
            type: 'string',
            format: 'cid',
          },
        },
      },
    },
  },
  DevSingiDoomArtifact: {
    lexicon: 1,
    id: 'dev.singi.doom.artifact',
    description:
      'A chunk of a game asset stored on a PDS. Enables storage-only mode: store WAD and engine as blobs, fetch and run locally.',
    defs: {
      main: {
        type: 'record',
        description:
          'Record containing one chunk of a game asset (WAD file, engine binary, etc.).',
        key: 'tid',
        record: {
          type: 'object',
          required: [
            'name',
            'index',
            'totalChunks',
            'hash',
            'data',
            'createdAt',
          ],
          properties: {
            name: {
              type: 'string',
              minLength: 1,
              maxLength: 500,
              maxGraphemes: 50,
              description:
                "Asset identifier (e.g. 'doom1-wad', 'engine-wasm').",
            },
            index: {
              type: 'integer',
              description: 'Zero-based chunk index within the asset.',
              minimum: 0,
            },
            totalChunks: {
              type: 'integer',
              description: 'Total number of chunks for this asset.',
              minimum: 1,
            },
            hash: {
              type: 'string',
              maxLength: 128,
              description:
                'SHA-256 hex digest of the complete reassembled asset (same across all chunks).',
            },
            data: {
              type: 'blob',
              accept: ['application/octet-stream'],
              maxSize: 1000000,
              description: 'Chunk payload (up to 1MB).',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
              description:
                'Client-declared timestamp when this artifact was originally created.',
            },
          },
        },
      },
    },
  },
  DevSingiDoomDefs: {
    lexicon: 1,
    id: 'dev.singi.doom.defs',
    description: 'Shared definitions for Doom over AT Protocol.',
    defs: {
      keyState: {
        type: 'object',
        description: 'Bitmask of currently pressed keys for one game tick.',
        required: ['keys'],
        properties: {
          keys: {
            type: 'integer',
            description:
              'Bitmask of pressed keys. Bit 0=forward, 1=backward, 2=left, 3=right, 4=fire, 5=use, 6=strafe, 7=speed, 8-15=weapon select, 16=escape, 17=enter, 18=tab (map), 19=pause.',
            minimum: 0,
            maximum: 1048575,
          },
        },
      },
      frameMeta: {
        type: 'object',
        description: 'Metadata about a rendered frame.',
        required: ['width', 'height', 'encoding'],
        properties: {
          width: {
            type: 'integer',
            description: 'Frame width in pixels.',
            minimum: 1,
            maximum: 640,
          },
          height: {
            type: 'integer',
            description: 'Frame height in pixels.',
            minimum: 1,
            maximum: 400,
          },
          encoding: {
            type: 'string',
            description: 'How the frame data is encoded.',
            knownValues: [
              'dev.singi.doom.defs#encodingPng',
              'dev.singi.doom.defs#encodingPaletteRle',
            ],
            maxLength: 500,
            maxGraphemes: 50,
          },
        },
      },
      encodingPng: {
        type: 'token',
        description: 'Frame encoded as PNG image blob.',
      },
      encodingPaletteRle: {
        type: 'token',
        description: 'Frame encoded as RLE-compressed palette-indexed buffer.',
      },
    },
  },
  DevSingiDoomFrame: {
    lexicon: 1,
    id: 'dev.singi.doom.frame',
    description: 'A rendered game frame written by the game server to its PDS.',
    defs: {
      main: {
        type: 'record',
        description: 'Record containing one or more rendered Doom frames.',
        key: 'tid',
        record: {
          type: 'object',
          required: ['session', 'seq', 'meta', 'frames', 'createdAt'],
          properties: {
            session: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
              description: 'The game session this frame belongs to.',
            },
            seq: {
              type: 'integer',
              description: 'Sequence number of the first frame in this batch.',
              minimum: 0,
            },
            meta: {
              type: 'ref',
              ref: 'lex:dev.singi.doom.defs#frameMeta',
              description: 'Frame dimensions and encoding metadata.',
            },
            frames: {
              type: 'array',
              description:
                'Array of frame blobs. Each blob is a PNG-encoded frame.',
              minLength: 1,
              maxLength: 35,
              items: {
                type: 'blob',
                accept: ['image/png'],
                maxSize: 65536,
              },
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
              description:
                'Client-declared timestamp when this frame was originally created.',
            },
          },
        },
      },
    },
  },
  DevSingiDoomInput: {
    lexicon: 1,
    id: 'dev.singi.doom.input',
    description:
      "Player keyboard input for one or more game ticks, written to the player's PDS.",
    defs: {
      main: {
        type: 'record',
        description:
          'Record containing player input for a batch of game ticks.',
        key: 'tid',
        record: {
          type: 'object',
          required: ['session', 'seq', 'keys', 'createdAt'],
          properties: {
            session: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
              description: 'The game session this input belongs to.',
            },
            seq: {
              type: 'integer',
              description:
                'Sequence number of the first tick in this batch. Monotonically increasing per session.',
              minimum: 0,
            },
            keys: {
              type: 'array',
              description:
                'Array of key bitmasks, one per tick. Allows batching multiple ticks in one record.',
              minLength: 1,
              maxLength: 35,
              items: {
                type: 'integer',
                minimum: 0,
                maximum: 1048575,
              },
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
              description:
                'Client-declared timestamp when this input was originally created.',
            },
          },
        },
      },
    },
  },
  DevSingiDoomSession: {
    lexicon: 1,
    id: 'dev.singi.doom.session',
    description:
      'A Doom game session with metadata about the WAD, player, and timing.',
    defs: {
      main: {
        type: 'record',
        description:
          'Record representing an active or completed Doom game session.',
        key: 'tid',
        record: {
          type: 'object',
          required: ['wad', 'player', 'status', 'tickRate', 'createdAt'],
          properties: {
            wad: {
              type: 'string',
              minLength: 1,
              maxLength: 1000,
              maxGraphemes: 100,
              description: "WAD file identifier (e.g. 'doom1-shareware').",
            },
            player: {
              type: 'string',
              format: 'did',
              description: 'DID of the player for this session.',
            },
            status: {
              type: 'string',
              knownValues: [
                'dev.singi.doom.session#active',
                'dev.singi.doom.session#paused',
                'dev.singi.doom.session#ended',
              ],
              maxLength: 500,
              maxGraphemes: 50,
              description: 'Current session status.',
            },
            tickRate: {
              type: 'integer',
              description: 'Target ticks per second (Doom default: 35).',
              minimum: 1,
              maximum: 35,
            },
            totalTicks: {
              type: 'integer',
              description: 'Total ticks processed so far.',
              minimum: 0,
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
              description:
                'Client-declared timestamp when this session was originally created.',
            },
          },
        },
      },
      active: {
        type: 'token',
        description: 'Session is actively running.',
      },
      paused: {
        type: 'token',
        description: 'Session is paused.',
      },
      ended: {
        type: 'token',
        description: 'Session has ended.',
      },
    },
  },
} as const satisfies Record<string, LexiconDoc>
export const schemas = Object.values(schemaDict) satisfies LexiconDoc[]
export const lexicons: Lexicons = new Lexicons(schemas)

export function validate<T extends { $type: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType: true,
): ValidationResult<T>
export function validate<T extends { $type?: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: false,
): ValidationResult<T>
export function validate(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: boolean,
): ValidationResult {
  return (requiredType ? is$typed : maybe$typed)(v, id, hash)
    ? lexicons.validate(`${id}#${hash}`, v)
    : {
        success: false,
        error: new ValidationError(
          `Must be an object with "${hash === 'main' ? id : `${id}#${hash}`}" $type property`,
        ),
      }
}

export const ids = {
  ComAtprotoRepoStrongRef: 'com.atproto.repo.strongRef',
  DevSingiDoomArtifact: 'dev.singi.doom.artifact',
  DevSingiDoomDefs: 'dev.singi.doom.defs',
  DevSingiDoomFrame: 'dev.singi.doom.frame',
  DevSingiDoomInput: 'dev.singi.doom.input',
  DevSingiDoomSession: 'dev.singi.doom.session',
} as const
