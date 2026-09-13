import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export function sha256Text(text) {
  return 'sha256:' + bytesToHex(sha256(new TextEncoder().encode(text)))
}
