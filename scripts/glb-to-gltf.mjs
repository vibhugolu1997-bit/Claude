// Convert a .glb into a single self-contained .gltf JSON (buffer embedded as base64).
// Used for hosts that only serve JSON, not binary glTF.  usage: node scripts/glb-to-gltf.mjs in.glb out.gltf.json
import fs from 'fs'
const [input, output] = process.argv.slice(2)
const b = fs.readFileSync(input)
const jsonLen = b.readUInt32LE(12)
const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString())
const binStart = 20 + jsonLen
const binLen = b.readUInt32LE(binStart)
const bin = b.subarray(binStart + 8, binStart + 8 + binLen)
json.buffers[0].uri = `data:application/octet-stream;base64,${bin.toString('base64')}`
fs.writeFileSync(output, JSON.stringify(json))
console.log(`wrote ${output} (${(fs.statSync(output).size / 1024).toFixed(0)} KB)`)
