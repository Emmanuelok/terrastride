'use client';
/* eslint-disable @next/next/no-img-element -- The Vite storefront serves its images directly from Cloudflare. */

import {useEffect, useState} from 'react';
import {ArrowUpRight} from 'lucide-react';
import type {Product} from '@/lib/catalogue';

const key = 'stride:recently-viewed:v1';
const changed = 'stride:recently-viewed';
function readIds(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200))].slice(0, 12) : [];
  } catch { return []; }
}
export function rememberProduct(id: string) {
  try { localStorage.setItem(key, JSON.stringify([id, ...readIds().filter(item => item !== id)].slice(0, 12))); window.dispatchEvent(new Event(changed)); } catch { /* Optional device history. */ }
}
export default function RecentlyViewed({currentId, onNavigate, money}: {
  currentId?: string; onNavigate: (url: string) => void; money: (value: number | null | undefined) => string;
}) {
  const [ids, setIds] = useState(readIds);
  const [result, setResult] = useState<{requested: string; products: Product[]} | null>(null);
  useEffect(() => {
    const sync = () => setIds(readIds());
    const syncStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) sync(); };
    window.addEventListener(changed, sync); window.addEventListener('storage', syncStorage);
    return () => { window.removeEventListener(changed, sync); window.removeEventListener('storage', syncStorage); };
  }, []);
  const requested = ids.filter(id => id !== currentId).slice(0, 6).join(',');
  const products = requested && result?.requested === requested ? result.products : [];
  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    let cancelled = false;
    fetch('/api/catalog?' + new URLSearchParams({ids: requested, limit: '12'}), {signal: controller.signal})
      .then(response => { if (!response.ok) throw Error(); return response.json() as Promise<{products: Product[]}>; })
      .then(data => {
        if (!Array.isArray(data.products)) throw Error();
        if (!cancelled && !controller.signal.aborted) {
          setResult({requested, products: requested.split(',').flatMap(id => data.products.find(product => product.id === id) || [])});
        }
      })
      .catch(() => {});
    return () => { cancelled = true; controller.abort(); };
  }, [requested]);
  if (!products.length) return null;
  return <section className="section recent-discovery" aria-labelledby="recent-discovery-title">
    <div className="compact-heading"><div><span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2 id="recent-discovery-title">Worth another look.</h2></div>
      <button type="button" onClick={() => {
        try { localStorage.removeItem(key); window.dispatchEvent(new Event(changed)); } catch { /* Optional device history. */ }
        setIds([]); setResult(null);
      }}>Clear history</button>
    </div>
    <div className="recent-discovery-rail">{products.map(product => <a key={product.id} href={'/product/' + encodeURIComponent(product.id)} onClick={event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault(); onNavigate('/product/' + encodeURIComponent(product.id));
    }}><div><img src={product.image} alt="" loading="lazy"/><ArrowUpRight size={20}/></div><small>{product.brand}</small><h3>{product.name}</h3><span>{money(product.priceGHS)}</span></a>)}</div>
    <p className="recent-history-note">Recently viewed on this browser. Prices are planning references.</p>
  </section>;
}
