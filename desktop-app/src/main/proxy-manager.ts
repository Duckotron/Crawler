import * as http from 'http';
import * as https from 'https';
import type { ProxyEntry } from '../shared/types';
import { generateId } from '../shared/utils';

export type RotationStrategy = 'round-robin' | 'random' | 'least-used';

export class ProxyManager {
  private proxies: ProxyEntry[] = [];
  private rrIndex = 0;
  private domainAssignments = new Map<string, string>(); // domain → proxyId
  private strategy: RotationStrategy = 'round-robin';
  private healthCheckInterval?: ReturnType<typeof setInterval>;

  constructor(strategy: RotationStrategy = 'round-robin') {
    this.strategy = strategy;
  }

  setProxies(proxies: ProxyEntry[]): void {
    this.proxies = proxies;
    this.rrIndex = 0;
  }

  addProxy(url: string): ProxyEntry {
    const protocol = url.startsWith('socks') ? 'socks5' :
      url.startsWith('https') ? 'https' : 'http';
    const proxy: ProxyEntry = {
      id: generateId(),
      url,
      protocol,
      active: true,
      healthy: undefined,
      successCount: 0,
      failCount: 0,
    };
    this.proxies.push(proxy);
    return proxy;
  }

  removeProxy(id: string): void {
    this.proxies = this.proxies.filter(p => p.id !== id);
  }

  getNext(domain?: string): ProxyEntry | null {
    const healthy = this.proxies.filter(p => p.active && p.healthy !== false);
    if (healthy.length === 0) return null;

    // Check domain assignment
    if (domain) {
      const assignedId = this.domainAssignments.get(domain);
      if (assignedId) {
        const assigned = healthy.find(p => p.id === assignedId);
        if (assigned) return assigned;
      }
    }

    switch (this.strategy) {
      case 'round-robin': {
        const proxy = healthy[this.rrIndex % healthy.length];
        this.rrIndex++;
        return proxy;
      }
      case 'random':
        return healthy[Math.floor(Math.random() * healthy.length)];
      case 'least-used': {
        return healthy.reduce((best, cur) =>
          cur.successCount + cur.failCount < best.successCount + best.failCount ? cur : best
        );
      }
    }
  }

  assignDomain(domain: string, proxyId: string): void {
    this.domainAssignments.set(domain, proxyId);
  }

  recordSuccess(id: string): void {
    const proxy = this.proxies.find(p => p.id === id);
    if (proxy) { proxy.successCount++; proxy.healthy = true; }
  }

  recordFailure(id: string): void {
    const proxy = this.proxies.find(p => p.id === id);
    if (proxy) {
      proxy.failCount++;
      if (proxy.failCount > 5 && proxy.failCount > proxy.successCount * 2) {
        proxy.healthy = false;
      }
    }
  }

  startHealthChecks(intervalMs = 60_000): void {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    this.healthCheckInterval = setInterval(() => this.checkAllProxies(), intervalMs);
    this.checkAllProxies();
  }

  stopHealthChecks(): void {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
  }

  private async checkAllProxies(): Promise<void> {
    const checkUrl = 'https://httpbin.org/ip';
    for (const proxy of this.proxies) {
      if (!proxy.active) continue;
      const healthy = await this.checkProxy(proxy, checkUrl);
      proxy.healthy = healthy;
      proxy.lastChecked = new Date().toISOString();
    }
  }

  private checkProxy(proxy: ProxyEntry, url: string): Promise<boolean> {
    return new Promise(resolve => {
      try {
        // Simple HTTP connect test (not full CONNECT tunnel, just connection test)
        const proxyUrl = new URL(proxy.url);
        const req = http.request({
          hostname: proxyUrl.hostname,
          port: parseInt(proxyUrl.port || '80', 10),
          method: 'CONNECT',
          path: new URL(url).host,
          timeout: 5000,
        }, () => { resolve(true); req.destroy(); });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
      } catch {
        resolve(false);
      }
    });
  }

  getAll(): ProxyEntry[] {
    return this.proxies;
  }

  getHealthy(): ProxyEntry[] {
    return this.proxies.filter(p => p.active && p.healthy !== false);
  }

  /**
   * Build proxy agent options for use with http/https module.
   * (Full SOCKS5 support would require the socks-proxy-agent package.)
   */
  buildAgentOptions(proxyId: string): { host: string; port: number; auth?: string } | null {
    const proxy = this.proxies.find(p => p.id === proxyId);
    if (!proxy) return null;
    try {
      const url = new URL(proxy.url);
      return {
        host: url.hostname,
        port: parseInt(url.port || '8080', 10),
        auth: url.username ? `${url.username}:${url.password}` : undefined,
      };
    } catch {
      return null;
    }
  }
}
