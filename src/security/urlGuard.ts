import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { normalizeHost, type Config } from '../config.js';
import { ToolError } from '../errors.js';

type Address = { address: string; family: number };
export type Resolver = (host: string) => Promise<Address[]>;
const resolveDns: Resolver = (host) =>
  lookup(host, { all: true, verbatim: true });

export function permittedAddress(
  address: string,
  allowLocal: boolean,
): boolean {
  if (!ipaddr.isValid(address)) return false;
  const range = ipaddr.process(address).range();
  return (
    range === 'unicast' ||
    (allowLocal && ['loopback', 'private', 'uniqueLocal'].includes(range))
  );
}

export class UrlGuard {
  constructor(
    private readonly config: Config,
    private readonly resolver: Resolver = resolveDns,
  ) {}

  parse(value: string): URL {
    try {
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        !url.hostname
      ) {
        throw new Error();
      }
      const host = normalizeHost(url.hostname);
      if (
        this.config.allowedDomains.length &&
        !this.config.allowedDomains.includes(host)
      )
        throw new Error();
      return url;
    } catch {
      throw new ToolError(
        'URL_BLOCKED',
        'Destination is not permitted by URL policy.',
      );
    }
  }

  async resolve(
    value: string,
  ): Promise<{ url: URL; address: string; family: number; port: number }> {
    const url = this.parse(value);
    const host = normalizeHost(url.hostname);
    try {
      const addresses = isIP(host)
        ? [{ address: host, family: isIP(host) }]
        : await this.resolver(host);
      if (
        !addresses.length ||
        addresses.some(
          (item) => !permittedAddress(item.address, this.config.allowLocal),
        )
      ) {
        throw new Error();
      }
      const selected = addresses[0]!;
      return {
        url,
        ...selected,
        port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
      };
    } catch {
      throw new ToolError(
        'URL_BLOCKED',
        'Destination could not be resolved to permitted addresses.',
      );
    }
  }
}
