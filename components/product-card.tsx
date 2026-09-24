'use client';
import type {MouseEvent} from 'react';
import {Heart, Plus, Scale} from 'lucide-react';
import type {Product} from '@/lib/catalogue';

export default function ProductCard({p, saved, busy, compared, money, onNavigate, onSave, onAdd, onCompare, onQuick}: {
  p: Product; saved: boolean; busy: boolean; compared: boolean;
  money: (value: number | null | undefined) => string;
  onNavigate: (url: string) => void; onSave: (p: Product) => Promise<void>;
  onAdd: (p: Product) => Promise<void>; onCompare: (p: Product) => void; onQuick: (p: Product) => void;
}) {
  const alternate = p.images?.find(image => image !== p.image);
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); onNavigate('/product/' + encodeURIComponent(p.id));
  };
  return <article className="product-card"><div className="product-photo">
    <button className={'save-icon ' + (saved ? 'is-saved' : '')} onClick={() => onSave(p)} disabled={busy} aria-pressed={saved} aria-label={(saved ? 'Unsave ' : 'Save ') + p.name}><Heart size={18} fill={saved ? 'currentColor' : 'none'}/></button>
    <a href={'/product/' + p.id} onClick={follow}><img className="product-primary-image" src={p.image} alt={p.name} loading="lazy" onError={event => { event.currentTarget.style.opacity = '.25'; event.currentTarget.alt = 'Image temporarily unavailable: ' + p.name; }}/>
      {alternate && <img className="product-alternate-image" src={alternate} alt="" aria-hidden="true" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; event.currentTarget.parentElement?.classList.add('alternate-unavailable'); }}/>}</a>
    <button className="quick-button" onClick={() => onQuick(p)}>Quick look <Plus size={16}/></button>
  </div><div className="product-copy"><span className="product-brand">{p.brand}</span><a className="product-name" href={'/product/' + p.id} onClick={follow}>{p.name}</a><span className="product-category">{p.category}</span>
    <div className="product-price"><div><strong>{money(p.priceGHS)}</strong><small>{p.sourceCurrency === 'GHS' ? 'Ghana reference price' : 'Planning estimate'}</small></div><button className="add-button" aria-label={'Add ' + p.name + ' to bag'} onClick={() => onAdd(p)} disabled={busy}><Plus size={21}/></button></div>
    <button className="compare-check" aria-pressed={compared} onClick={() => onCompare(p)}><Scale size={14}/>{compared ? 'Added to compare' : 'Compare'}</button>
  </div></article>;
}
