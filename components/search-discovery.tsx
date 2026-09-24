'use client';
/* eslint-disable @next/next/no-img-element -- The Vite storefront serves its images directly from Cloudflare. */

import {useEffect, useId, useRef, useState} from 'react';
import {ArrowUpRight, Clock3, Search, X} from 'lucide-react';
import type {Product} from '@/lib/catalogue';
import './shopping-discovery.css';

const storageKey = 'stride:searches:v1';
const suggestions = ['Dumbbells', 'Running shoes', 'Protein', 'Yoga mats'];
function readSearches(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(saved) ? saved.filter((value): value is string => typeof value === 'string' && value.length <= 150).slice(0, 5) : [];
  } catch { return []; }
}

export default function SearchDiscovery({value, onChange, onNavigate, money}: {
  value: string; onChange: (value: string) => void; onNavigate: (url: string) => void;
  money: (value: number | null | undefined) => string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState(readSearches);
  const [result, setResult] = useState<{query: string; products: Product[]; failed: boolean} | null>(null);
  const [selection, setSelection] = useState<{query: string; key: string} | null>(null);
  const query = value.trim();
  const products = result?.query === query ? result.products : [];
  const pending = open && !!query && result?.query !== query;
  const failed = result?.query === query && result.failed;
  const choices = query ? products : [...new Set([...recent, ...suggestions])].slice(0, 6);
  const active = selection?.query === query
    ? choices.findIndex(choice => (typeof choice === 'string' ? choice : choice.id) === selection.key)
    : -1;

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) { setOpen(false); setSelection(null); }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  useEffect(() => {
    if (!query || !open) return;
    const controller = new AbortController();
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch('/api/catalog?' + new URLSearchParams({q: query, limit: '5'}), {signal: controller.signal})
        .then(response => { if (!response.ok) throw Error('Search unavailable'); return response.json() as Promise<{products: Product[]}>; })
        .then(data => {
          if (!Array.isArray(data.products)) throw Error('Search unavailable');
          if (!cancelled && !controller.signal.aborted) setResult({query, products: data.products, failed: false});
        })
        .catch(() => {
          if (!cancelled && !controller.signal.aborted) setResult({query, products: [], failed: true});
        });
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [query, open]);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({block: 'nearest'});
  }, [active, id, open]);

  const remember = (term: string) => {
    if (!term) return;
    const next = [term, ...readSearches().filter(item => item.toLowerCase() !== term.toLowerCase())].slice(0, 5);
    setRecent(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Browsing works without storage. */ }
  };
  const search = (term: string) => {
    remember(term); onChange(term); setOpen(false); setSelection(null);
    onNavigate('/shop' + (term ? '?q=' + encodeURIComponent(term) : ''));
  };
  const choose = (index: number) => {
    const choice = choices[index];
    if (typeof choice === 'string') search(choice);
    else if (choice) { remember(query); setOpen(false); setSelection(null); onNavigate('/product/' + encodeURIComponent(choice.id)); }
  };

  return <div className="search-discovery" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setSelection(null); }
  }}>
    <form className="header-search" role="search" onSubmit={event => { event.preventDefault(); if (active >= 0 && open) choose(active); else search(query); }}>
      <Search size={20} aria-hidden="true"/>
      <input value={value} maxLength={150} onChange={event => { onChange(event.target.value); setSelection(null); setOpen(true); }}
        onFocus={() => { setOpen(true); setSelection(null); }} placeholder="Search equipment, nutrition, apparel…" aria-label="Search products"
        role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && active >= 0 && active < choices.length ? `${id}-option-${active}` : undefined}
        autoComplete="off" onKeyDown={event => {
          if (event.key === 'Escape') { setOpen(false); setSelection(null); }
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            if (choices.length) {
              const index = event.key === 'ArrowDown' ? (active + 1) % choices.length : (active <= 0 ? choices.length - 1 : active - 1);
              const choice = choices[index];
              setSelection({query, key: typeof choice === 'string' ? choice : choice.id});
            }
          }
        }}/>
      {value && <button type="button" aria-label="Clear product search" onClick={() => { onChange(''); setSelection(null); setOpen(true); root.current?.querySelector('input')?.focus(); }}><X size={16}/></button>}
      <button type="submit" aria-label="Submit product search"><ArrowUpRight size={19}/></button>
    </form>
    {open && <div className="search-suggestions">
      <div className="search-suggestions-heading"><span>{query ? 'FIND YOUR NEXT' : recent.length ? 'RECENT & SUGGESTED' : 'A LITTLE INSPIRATION'}</span>
        {!query && recent.length > 0 && <button type="button" onClick={() => { try { localStorage.removeItem(storageKey); } catch {} setRecent([]); setSelection(null); }}>Clear history</button>}
      </div>
      {pending && <p className="search-feedback" role="status">Finding your next essential…</p>}
      {!pending && query && !products.length && <p className="search-feedback" role="status">{failed ? 'Open the full search to try again.' : 'Try a product, sport or brand.'}</p>}
      <div id={`${id}-list`} role="listbox" aria-label="Search suggestions" aria-busy={pending}>
        {choices.map((choice, index) => <button type="button" role="option" aria-selected={active === index}
          id={`${id}-option-${index}`} key={typeof choice === 'string' ? choice : choice.id}
          className={'search-suggestion ' + (active === index ? 'is-active' : '')} tabIndex={-1}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
          {typeof choice === 'string' ? <><span className="search-term-icon">{recent.includes(choice) ? <Clock3 size={18}/> : <Search size={18}/>}</span><span>{choice}</span><ArrowUpRight size={16}/></>
            : <><img src={choice.image} alt=""/><span><small>{choice.brand}</small><strong>{choice.name}</strong><em>{money(choice.priceGHS)}</em></span><ArrowUpRight size={16}/></>}
        </button>)}
      </div>
      {query && <button type="button" className="search-all" onClick={() => search(query)}>Explore results for “{query}” <ArrowUpRight size={18}/></button>}
      {!query && recent.length > 0 && <p className="search-history-note">Search history stays in this browser.</p>}
    </div>}
  </div>;
}
