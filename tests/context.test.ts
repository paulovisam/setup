import { describe, expect, it } from 'vitest'
import { detectArch, isUbuntu2404, parseOsRelease } from '../src/context.ts'

const ubuntu2404 = `
NAME="Ubuntu"
VERSION_ID="24.04"
ID=ubuntu
ID_LIKE=debian
`

describe('sistema', () => {
  it('reconhece Ubuntu 24.04 a partir do os-release', () => {
    const os = parseOsRelease(ubuntu2404)
    expect(isUbuntu2404({ osId: os.id, osVersionId: os.versionId })).toBe(true)
  })

  it('não trata outra versão como Ubuntu 24.04', () => {
    const os = parseOsRelease('ID=ubuntu\nVERSION_ID="22.04"\n')
    expect(isUbuntu2404({ osId: os.id, osVersionId: os.versionId })).toBe(false)
  })

  it('mapeia a arquitetura do deb e do Grok', () => {
    expect(detectArch('aarch64')).toEqual({ debArch: 'arm64', grokPlatform: 'linux-arm64' })
    expect(detectArch('arm64')).toEqual({ debArch: 'arm64', grokPlatform: 'linux-arm64' })
    expect(detectArch('x86_64')).toEqual({ debArch: 'amd64', grokPlatform: 'linux-x64' })
  })
})
