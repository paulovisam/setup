import { packageSteps } from './base-packages.ts'
import { toolchainSteps } from './base-toolchain.ts'
import type { Step } from '../types.ts'

export function baseSteps(): Step[] {
  return [...toolchainSteps(), ...packageSteps()]
}
