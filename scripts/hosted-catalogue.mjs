import {readFile} from 'node:fs/promises';

export async function loadHostedCatalogue(root) {
  const manifest = JSON.parse(await readFile(root + '/data/image-mirror-manifest.json', 'utf8'));
  if (manifest.summary.mirrored !== manifest.summary.total || manifest.summary.failed || manifest.summary.pending) {
    throw new Error('Complete the image mirror before building a deployment.');
  }
  function localise(value, key) {
    if (Array.isArray(value)) return value.map(v => localise(v, key === 'images' ? 'image' : key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, localise(v,k)]));
    if (key === 'image' && typeof value === 'string' && value.startsWith('https://')) {
      const image = manifest.images[value];
      if (!image || !/^\/catalogue-images\/[a-f0-9]{64}\.(jpg|png|gif|webp|avif)$/.test(image.path)) throw new Error('Missing mirrored image: '+value);
      return image.path;
    }
    return value;
  }
  const products = localise(JSON.parse(await readFile(root+'/data/products.json','utf8')));
  const featured = localise(JSON.parse(await readFile(root+'/data/storefront-edit.json','utf8')));
  return {products: JSON.stringify(products), featured: JSON.stringify(featured)};
}
