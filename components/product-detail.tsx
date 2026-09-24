'use client';

import {useEffect, useId, useRef, useState} from 'react';
import {ArrowUpRight, Check, ChevronLeft, ChevronRight, Heart, Minus, Plus, Scale, Share2, ShoppingBag, Truck, X, ZoomIn, ZoomOut} from 'lucide-react';
import {Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger} from '@/components/ui/dialog';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import type {Product} from '@/lib/catalogue';
import './product-detail.css';

export type ProductDetailProps = {
  p: Product;
  compact?: boolean;
  gallery: number;
  onGalleryChange: (index: number) => void;
  city: string;
  money: (value: number | null | undefined) => string;
  onAdd: (product: Product, quantity: number) => Promise<void>;
  onSave: (product: Product) => Promise<void>;
  onCompare: (product: Product) => void;
  busy: boolean;
  saved: boolean;
  onNavigate?: (url: string) => void;
};

const referenceRates: Record<string, number> = {CAD: 9, USD: 12, GBP: 16, EUR: 14};
const clampQuantity = (value: number) => Math.max(1, Math.min(50, Math.trunc(value) || 1));

export function ProductDetail(props: ProductDetailProps) {
  return <ProductDetailContent key={props.p.id} {...props}/>;
}

function ProductDetailContent({p, compact = false, gallery, onGalleryChange, city, money, onAdd, onSave, onCompare, busy, saved, onNavigate}: ProductDetailProps) {
  const images = [...new Set([p.image, ...(p.images || [])].filter(Boolean))];
  const imageIndex = gallery >= 0 && gallery < images.length ? gallery : 0;
  const currentImage = images[imageIndex];
  const [quantity, setQuantity] = useState(1);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [shareStatus, setShareStatus] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [unavailableImage, setUnavailableImage] = useState('');
  const quantityId = useId();
  const shareId = useId();
  const thumbnailRef = useRef<HTMLButtonElement>(null);
  const thumbnailStripRef = useRef<HTMLDivElement>(null);
  const shareInputRef = useRef<HTMLInputElement>(null);
  const lightboxViewportRef = useRef<HTMLDivElement>(null);
  const productUrl = '/product/' + encodeURIComponent(p.id);
  const ProductHeading = compact ? 'h2' : 'h1';

  useEffect(() => {
    const thumbnail = thumbnailRef.current;
    const strip = thumbnailStripRef.current;
    if (thumbnail && strip) {
      strip.scrollTo({left: thumbnail.offsetLeft - (strip.clientWidth - thumbnail.clientWidth) / 2, behavior: 'auto'});
    }
  }, [imageIndex]);

  useEffect(() => {
    if (shareUrl) {
      shareInputRef.current?.focus();
      shareInputRef.current?.select();
    }
  }, [shareUrl]);

  function selectImage(index: number) {
    onGalleryChange(index);
    setZoomed(false);
    lightboxViewportRef.current?.scrollTo({top: 0, left: 0});
  }

  function moveImage(direction: number) {
    if (images.length > 1) selectImage((imageIndex + direction + images.length) % images.length);
  }

  async function shareProduct() {
    const url = new URL(productUrl, window.location.origin).href;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable');
      await navigator.clipboard.writeText(url);
      setShareUrl('');
      setShareStatus('Product link copied.');
    } catch {
      setShareUrl(url);
      setShareStatus('Select and copy the product link below.');
      if (shareUrl === url) {
        shareInputRef.current?.focus();
        shareInputRef.current?.select();
      }
    }
  }

  return <div className={'product-detail stride-product-detail' + (compact ? ' compact' : '')}>
    <div className="detail-gallery stride-product-gallery">
      <Dialog open={lightboxOpen} onOpenChange={open => {setLightboxOpen(open); if (!open) setZoomed(false);}}>
        <div className="stride-product-image-frame">
          <DialogTrigger asChild>
            <button type="button" className="stride-product-image-trigger" disabled={!currentImage} aria-label={'Enlarge image of ' + p.name}>
              {currentImage && unavailableImage !== currentImage ? <img className="main-product-image" src={currentImage} alt={p.name + ' — view ' + (imageIndex + 1)} onError={() => setUnavailableImage(currentImage)}/> : <span className="stride-product-image-unavailable">Image unavailable</span>}
              {currentImage && <span className="stride-product-zoom-hint"><ZoomIn size={17} aria-hidden="true"/>Take a closer look</span>}
            </button>
          </DialogTrigger>
          {images.length > 1 && <div className="stride-product-image-arrows">
            <button type="button" onClick={() => moveImage(-1)} aria-label="Previous product image"><ChevronLeft size={20} aria-hidden="true"/></button>
            <button type="button" onClick={() => moveImage(1)} aria-label="Next product image"><ChevronRight size={20} aria-hidden="true"/></button>
          </div>}
        </div>
        <DialogContent className="stride-product-lightbox top-0 left-0 translate-x-0 translate-y-0" showCloseButton={false} onKeyDown={event => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            moveImage(event.key === 'ArrowLeft' ? -1 : 1);
          }
        }}>
          <div className="stride-product-lightbox-header">
            <div>
              <DialogTitle>{p.name}</DialogTitle>
              <DialogDescription>Use the arrows to explore. Select the image to zoom, or press Escape to close.</DialogDescription>
            </div>
            <div className="stride-product-lightbox-tools">
              <button type="button" onClick={() => setZoomed(value => !value)} aria-label={zoomed ? 'Zoom out' : 'Zoom in'} aria-pressed={zoomed}>
                {zoomed ? <ZoomOut size={22} aria-hidden="true"/> : <ZoomIn size={22} aria-hidden="true"/>}
              </button>
              <DialogClose asChild><button type="button" aria-label="Close image viewer"><X size={24} aria-hidden="true"/></button></DialogClose>
            </div>
          </div>
          <div className="stride-product-lightbox-viewport" ref={lightboxViewportRef}>
            <button type="button" className={'stride-product-lightbox-image' + (zoomed ? ' is-zoomed' : '')} onClick={() => setZoomed(value => !value)} aria-label={zoomed ? 'Zoom out of product image' : 'Zoom into product image'} aria-pressed={zoomed}>
              {currentImage && unavailableImage !== currentImage ? <img src={currentImage} alt={p.name + ' — view ' + (imageIndex + 1)} onError={() => setUnavailableImage(currentImage)}/> : <span className="stride-product-image-unavailable">Image unavailable</span>}
            </button>
          </div>
          <div className="stride-product-lightbox-footer">
            {images.length > 1 ? <>
              <button type="button" onClick={() => moveImage(-1)} aria-label="Previous product image"><ChevronLeft size={22} aria-hidden="true"/><span>Previous</span></button>
              <span aria-live="polite" aria-atomic="true">{imageIndex + 1} / {images.length}</span>
              <button type="button" onClick={() => moveImage(1)} aria-label="Next product image"><span>Next</span><ChevronRight size={22} aria-hidden="true"/></button>
            </> : <span>Select image to {zoomed ? 'zoom out' : 'zoom in'}</span>}
          </div>
        </DialogContent>
      </Dialog>
      {images.length > 1 && <div className="thumbnails stride-product-thumbnails" ref={thumbnailStripRef} role="group" aria-label="Product images">
        {images.map((image, index) => <button type="button" key={image} ref={index === imageIndex ? thumbnailRef : undefined} className={index === imageIndex ? 'active' : ''} onClick={() => selectImage(index)} aria-label={'View product image ' + (index + 1)} aria-pressed={index === imageIndex}>
          <img src={image} alt="" loading="lazy"/>
        </button>)}
      </div>}
    </div>
    <div className="detail-copy stride-product-copy">
      <span className="eyebrow orange">{p.brand}</span>
      <ProductHeading className="stride-product-title">{p.name}</ProductHeading>
      <p>{p.category}</p>
      <div className="detail-price">{money(p.priceGHS)}</div>
      <p className="price-note">{p.sourceCurrency === 'GHS' ? 'Ghana retailer reference price' : 'Planning estimate in GHS'}. Final STRIDE price, import costs and availability require confirmation.</p>
      <div className="stride-product-purchase">
        <label htmlFor={quantityId}>Quantity</label>
        <div className="stride-product-purchase-row">
          <div className="stride-product-quantity">
            <button type="button" onClick={() => setQuantity(value => clampQuantity(value - 1))} disabled={busy || quantity === 1} aria-label="Decrease quantity"><Minus size={17} aria-hidden="true"/></button>
            <input id={quantityId} type="number" inputMode="numeric" min={1} max={50} step={1} value={quantity} disabled={busy} onChange={event => setQuantity(clampQuantity(Number(event.target.value)))}/>
            <button type="button" onClick={() => setQuantity(value => clampQuantity(value + 1))} disabled={busy || quantity === 50} aria-label="Increase quantity"><Plus size={17} aria-hidden="true"/></button>
          </div>
          <button type="button" className="button orange-button stride-product-add" onClick={() => void onAdd(p, quantity)} disabled={busy}><ShoppingBag size={19} aria-hidden="true"/>Add to bag</button>
        </div>
        <div className="stride-product-secondary-actions">
          <button type="button" className={saved ? 'is-saved' : ''} onClick={() => void onSave(p)} disabled={busy} aria-pressed={saved} aria-label={saved ? 'Remove product from saved products' : 'Save product'}><Heart size={19} fill={saved ? 'currentColor' : 'none'} aria-hidden="true"/>{saved ? 'Saved' : 'Save product'}{saved && <Check size={14} aria-hidden="true"/>}</button>
          <button type="button" onClick={() => onCompare(p)}><Scale size={19} aria-hidden="true"/>Compare</button>
          <button type="button" onClick={() => void shareProduct()}><Share2 size={18} aria-hidden="true"/>Share product</button>
        </div>
        {shareStatus && <p className="stride-product-share-status" role="status">{shareStatus}</p>}
        {shareUrl && <div className="stride-product-share-fallback"><label htmlFor={shareId}>Product link</label><input id={shareId} ref={shareInputRef} value={shareUrl} readOnly onFocus={event => event.currentTarget.select()}/></div>}
      </div>
      <div className="detail-assurance"><Truck size={20} aria-hidden="true"/><span>Delivery to {city}<small>Delivery and assembly quoted before purchase</small></span></div>
      <Tabs defaultValue="details">
        <TabsList className="product-tabs" aria-label="Product information"><TabsTrigger value="details">Details</TabsTrigger><TabsTrigger value="source">Source &amp; price</TabsTrigger><TabsTrigger value="delivery">Delivery</TabsTrigger></TabsList>
        <TabsContent value="details">
          <p className="description-text">{p.description || p.name}</p>
          {p.specs && <dl>{Object.entries(p.specs).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}
        </TabsContent>
        <TabsContent value="source">
          <p>Catalogue source: {p.sourceName || p.brand}. {p.sourcePrice ? `Listed reference: ${p.sourceCurrency} ${p.sourcePrice}.` : ''}</p>
          <p>Source photography can show different sizes, colours or flavours of this model. The reference price applies to the source option listed below. This listing does not confirm STRIDE stock, a supplier partnership or local product registration.</p>
          {p.specs?.['Reference option'] && <p>Reference option: {p.specs['Reference option']}</p>}
          {p.sourceCurrency !== 'GHS' && <p>Illustrative conversion: 1 {p.sourceCurrency} = {referenceRates[p.sourceCurrency || ''] || '—'} GHS, rounded up to GH₵5. This is a fixed planning assumption, not a live exchange rate.</p>}
          <a className="underlined" href={p.sourceUrl} target="_blank" rel="noreferrer">View source listing <ArrowUpRight size={16} aria-hidden="true"/></a>
        </TabsContent>
        <TabsContent value="delivery"><p>Choose your Ghana delivery location at quotation. Large machines need access measurements and installation confirmation. A written quote will set delivery fees, timing, warranty and returns before you pay.</p></TabsContent>
      </Tabs>
      {/supplement|nutrition|vitamin|protein/i.test(p.department) && <p className="nutrition-note">Check the exact label, allergens, batch and expiry with the supplier. Supplement suitability and Ghana FDA registration must be verified before sale; this catalogue does not provide medical advice.</p>}
      {compact && <a className="underlined stride-product-full-link" href={productUrl} onClick={event => {
        if (onNavigate && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {event.preventDefault(); onNavigate(productUrl);}
      }}>View full product details <ArrowUpRight size={16} aria-hidden="true"/></a>}
    </div>
  </div>;
}

export default ProductDetail;
