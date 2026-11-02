/**
 * A minimal software WebAuthn authenticator (ES256, "none" attestation) used
 * to exercise the real SimpleWebAuthn verification path in tests.
 */
import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

const b64url = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();

export class SoftAuthenticator {
  credentialId = randomBytes(16);
  private privateKey: KeyObject;
  private publicJwk: { x: string; y: string };
  counter = 0;
  userHandle: string | null = null;
  /** Flags: UP | UV, plus BE/BS to look like a synced passkey. */
  uv = true;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    this.publicJwk = jwk;
  }

  private flags(attested: boolean) {
    return 0x01 | (this.uv ? 0x04 : 0) | 0x08 | 0x10 | (attested ? 0x40 : 0);
  }

  register(options: PublicKeyCredentialCreationOptionsJSON, origin: string): RegistrationResponseJSON {
    this.userHandle = options.user.id;
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
    const cose = new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(this.publicJwk.x, 'base64url')],
      [-3, Buffer.from(this.publicJwk.y, 'base64url')],
    ]);
    const credIdLen = Buffer.alloc(2);
    credIdLen.writeUInt16BE(this.credentialId.length);
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const authData = Buffer.concat([
      sha256(options.rp.id!),
      Buffer.from([this.flags(true)]),
      counter,
      Buffer.alloc(16), // aaguid
      credIdLen,
      this.credentialId,
      Buffer.from(isoCBOR.encode(cose as never)),
    ]);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]) as never);
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
    };
  }

  authenticate(options: PublicKeyCredentialRequestOptionsJSON, origin: string, overrides: { counter?: number } = {}): AuthenticationResponseJSON {
    this.counter = overrides.counter ?? this.counter + 1;
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha256(options.rpId!), Buffer.from([this.flags(false)]), counter]);
    const signer = createSign('SHA256');
    signer.update(Buffer.concat([authData, sha256(clientDataJSON)]));
    const signature = signer.sign(this.privateKey);
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: this.userHandle ?? undefined,
      },
    };
  }
}
