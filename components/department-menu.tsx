'use client';
/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element -- This storefront uses a Vite SPA router and its own Cloudflare image assets. */

import {useEffect, useRef, useState, type MouseEvent} from 'react';
import {createPortal} from 'react-dom';
import {ArrowRight, ArrowUpRight, ChevronRight, Dumbbell, LoaderCircle, Search, X} from 'lucide-react';
import './department-menu.css';

export type MenuDepartment = {
  id: string;
  name: string;
  subtitle?: string;
  image?: string;
  categories: {name: string; image?: string}[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  departments: MenuDepartment[];
  onNavigate: (url: string) => void;
};

function MenuImage({src, className = ''}: {src?: string; className?: string}) {
  const [failedSource, setFailedSource] = useState<string>();
  const localSource = src?.startsWith('/') && !src.startsWith('//') ? src : undefined;
  return <span className={`stride-menu-image ${className}`} aria-hidden="true">
    {localSource && failedSource !== localSource
      ? <img src={localSource} alt="" loading="lazy" decoding="async" onError={() => setFailedSource(localSource)}/>
      : <Dumbbell size={26} strokeWidth={1.3}/>}
  </span>;
}

const shopPath = (department: string, category?: string) => {
  const params = new URLSearchParams({department});
  if (category) params.set('category', category);
  return `/shop?${params}`;
};

export default function DepartmentMenu({open, onClose, departments, onNavigate}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const departmentListRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const search = query.trim().toLocaleLowerCase();
  const visibleDepartments = departments.filter(department => !search ||
    department.name.toLocaleLowerCase().includes(search) ||
    department.categories.some(category => category.name.toLocaleLowerCase().includes(search)));
  const selected = visibleDepartments.find(department => department.id === selectedId) || visibleDepartments[0];
  const categories = selected?.categories.filter(category => !search ||
    selected.name.toLocaleLowerCase().includes(search) || category.name.toLocaleLowerCase().includes(search)) || [];

  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const trigger = document.querySelector<HTMLElement>('[data-department-menu-trigger]') ||
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    // Keep the mobile keyboard closed until someone chooses to search.
    closeRef.current?.focus({preventScroll: true});
    return () => {
      dialog.close();
      document.documentElement.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({preventScroll: true});
    };
  }, [open]);

  const navigate = (event: MouseEvent<HTMLAnchorElement>, url: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onClose();
    onNavigate(url);
  };

  const selectDepartment = (id: string) => {
    setSelectedId(id);
    contentRef.current?.scrollTo({top: 0});
  };

  const resetSearch = () => {
    setQuery('');
    departmentListRef.current?.scrollTo({top: 0});
    contentRef.current?.scrollTo({top: 0});
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <dialog ref={dialogRef} id="departments-menu" className="stride-department-dialog"
      aria-labelledby="stride-menu-title" aria-describedby="stride-menu-description"
      onKeyDown={event => {if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); onClose();}}}
      onCancel={event => {event.preventDefault(); onClose();}}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <div className="stride-menu-shell">
        <div className="stride-menu-top">
          <div className="stride-menu-heading">
            <div><span className="stride-menu-kicker">FIND YOUR MOVEMENT</span><h2 id="stride-menu-title">A world of possibility.</h2></div>
            <button ref={closeRef} className="stride-menu-close" type="button" onClick={onClose} aria-label="Close departments"><X size={22}/></button>
          </div>
          <p id="stride-menu-description">Find the equipment and everyday essentials for your next move.</p>
          <label className="stride-menu-search"><Search size={20} aria-hidden="true"/>
            <span className="stride-menu-sr-only">Search departments and categories</span>
            <input type="search" value={query} onChange={event => {
              setQuery(event.target.value);
              departmentListRef.current?.scrollTo({top: 0});
              contentRef.current?.scrollTo({top: 0});
            }} placeholder="Search departments or categories" autoComplete="off" spellCheck={false}/>
            {query ? <button type="button" onClick={resetSearch} aria-label="Clear department search"><X size={17}/></button> : <span className="stride-menu-search-hint">EXPLORE</span>}
          </label>
        </div>

        {!departments.length ? <div className="stride-menu-empty" role="status"><LoaderCircle className="stride-menu-loading" size={32}/><h3>Finding your movement…</h3><p>Your departments are loading.</p><a href="/shop" onClick={event => navigate(event, '/shop')}>Browse the collection <ArrowRight size={17}/></a></div>
          : !visibleDepartments.length ? <div className="stride-menu-empty" role="status"><Search size={32}/><h3>Let’s try another direction.</h3><p>No departments or categories match “{query}”.</p><button type="button" onClick={resetSearch}>Explore all departments <ArrowRight size={17}/></button></div>
            : <div className="stride-menu-body">
              <nav ref={departmentListRef} className="stride-menu-departments" aria-label="Choose a department">
                <span className="stride-menu-list-label">{search ? 'MATCHING DEPARTMENTS' : 'ALL DEPARTMENTS'}</span>
                {visibleDepartments.map(department => <button key={department.id} type="button"
                  className={`stride-menu-department ${department.id === selected?.id ? 'is-active' : ''}`}
                  aria-pressed={department.id === selected?.id} aria-controls="stride-menu-categories"
                  onClick={() => selectDepartment(department.id)}
                  onKeyDown={event => {
                    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
                    if (!keys.includes(event.key)) return;
                    event.preventDefault();
                    const index = visibleDepartments.findIndex(item => item.id === department.id);
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? visibleDepartments.length - 1 :
                      (index + (event.key === 'ArrowDown' ? 1 : -1) + visibleDepartments.length) % visibleDepartments.length;
                    const buttons = departmentListRef.current?.querySelectorAll<HTMLButtonElement>('.stride-menu-department');
                    buttons?.[next]?.focus();
                    buttons?.[next]?.scrollIntoView({block: 'nearest'});
                    selectDepartment(visibleDepartments[next].id);
                  }}>
                  <MenuImage src={department.image}/><span>{department.name}</span><ChevronRight size={17} aria-hidden="true"/>
                </button>)}
              </nav>

              <section ref={contentRef} id="stride-menu-categories" className="stride-menu-content" aria-labelledby="stride-menu-selected-title" tabIndex={0}>
                {selected ? <>
                  <div className="stride-menu-feature">
                    <div><span className="stride-menu-kicker">YOUR NEXT CHAPTER</span><h3 id="stride-menu-selected-title">{selected.name}</h3><p>{selected.subtitle || 'Find what moves you. Make it yours.'}</p>
                      <a href={shopPath(selected.id)} onClick={event => navigate(event, shopPath(selected.id))}>Shop this department <ArrowUpRight size={18}/></a>
                    </div><MenuImage src={selected.image} className="stride-menu-feature-image"/>
                  </div>
                  <div className="stride-menu-category-heading"><h4>{search ? 'Find your match' : 'Explore the collection'}</h4><span>MADE FOR YOUR NEXT</span></div>
                  <div className="stride-menu-category-grid">
                    {categories.map(category => <a className="stride-menu-category" key={category.name} href={shopPath(selected.id, category.name)}
                      onClick={event => navigate(event, shopPath(selected.id, category.name))}>
                      <MenuImage src={category.image || selected.image}/><span>{category.name}<ArrowUpRight size={16} aria-hidden="true"/></span>
                    </a>)}
                  </div>
                  <a className="stride-menu-discover" href="/departments" onClick={event => navigate(event, '/departments')}><span>Keep exploring.<small>Find a new way to move.</small></span><ArrowUpRight size={24}/></a>
                </> : null}
              </section>
            </div>}
        <div className="stride-menu-footer"><span>EVERY BODY. EVERY AMBITION.</span><a href="/shop" onClick={event => navigate(event, '/shop')}>Shop everything <ArrowRight size={16}/></a></div>
      </div>
    </dialog>, document.body,
  );
}
