# Vendored front-end assets

Third-party files served from the instance instead of a public CDN.

## Why they live here

Every file in this directory is something the interface stops working without, and a CDN
is a dependency DVinyl cannot assume: an ad blocker, a DNS filter, a company network or a
homelab with no outbound internet access are each enough to take one out (issue #133).
A self-hosted app that only renders when three third-party domains answer is not really
self-hosted. Served locally, none of that applies, and nothing upstream can change what an
instance runs without a commit here.

The version is in every filename on purpose: it is what lets a file be cached hard and
still change when it should.

## What is here

| File | Version | Used by | Without it |
| :--- | :------ | :------ | :--------- |
| `tailwind-3.4.17.min.js` | 3.4.17 | every page | no utility class exists, so no layout at all |
| `font-awesome-6.7.2/` | 6.7.2 | every page | every icon in the interface disappears |
| `flowbite-1.6.5.min.js` | 1.6.5 | every page | dropdowns and modals stop opening |
| `chart-4.4.7.umd.min.js` | 4.4.7 | the estimate modal | the collection value history draws nothing |
| `zxing-0.23.0.umd.min.js` | 0.23.0 | the add page | the barcode scanner never starts |

Tailwind, Flowbite and Chart.js are MIT licensed. Font Awesome Free is CC BY 4.0 (icons),
SIL OFL 1.1 (fonts) and MIT (code). ZXing for JS is Apache 2.0.

Font Awesome keeps the directory layout the CDN serves, because its stylesheet reaches its
fonts through `url(../webfonts/...)`: `css/all.min.css` next to `webfonts/`, unmodified. All
eight font files are present even though a modern browser only ever fetches the `.woff2`
ones, so nothing 404s on an older client.

## To update

    V=<new version>
    curl -sL https://cdn.tailwindcss.com/$V                                                  -o tailwind-$V.min.js
    curl -sL https://cdnjs.cloudflare.com/ajax/libs/flowbite/$V/flowbite.min.js              -o flowbite-$V.min.js
    curl -sL https://cdn.jsdelivr.net/npm/chart.js@$V/dist/chart.umd.min.js                  -o chart-$V.umd.min.js
    curl -sL https://unpkg.com/@zxing/library@$V/umd/index.min.js                            -o zxing-$V.umd.min.js

    # Font Awesome, stylesheet plus the eight font files it references
    mkdir -p font-awesome-$V/css font-awesome-$V/webfonts
    curl -sL https://cdnjs.cloudflare.com/ajax/libs/font-awesome/$V/css/all.min.css -o font-awesome-$V/css/all.min.css
    for f in fa-solid-900 fa-regular-400 fa-brands-400 fa-v4compatibility; do
      for ext in woff2 ttf; do
        curl -sL https://cdnjs.cloudflare.com/ajax/libs/font-awesome/$V/webfonts/$f.$ext -o font-awesome-$V/webfonts/$f.$ext
      done
    done

Then point the views at the new filenames, delete the old files, and record the hashes
below. The references live in `views/partials/header.ejs` (Tailwind, Font Awesome,
Flowbite), `views/login.ejs` and `views/setup.ejs` (Tailwind, Font Awesome),
`views/collection.ejs` (Chart.js) and `core/views/add.ejs` (ZXing). Tailwind's runtime
config stays inline in `views/partials/header.ejs`.

## Hashes

Each file is byte-for-byte what its CDN serves. Verify with `sha256sum`.

    tailwind-3.4.17.min.js            176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15
    flowbite-1.6.5.min.js             e41628c3455d514c7264a2ddfe02c26f29e77b48f8962aa42922d9f5cf586609
    chart-4.4.7.umd.min.js            206b6e8bb00fc7bba2c7ee80ca41db3e9e05ba7be0aa35abeba9cfd5357f5d0e
    zxing-0.23.0.umd.min.js           3ede94153fb0c5b67a12d7adff6decd827c2b22714fdc6faecf27a8f20937ea6
    font-awesome-6.7.2/css/all.min.css 74005d7c17d4a02f2f25404ec0655d9bc2fdaa53166874c87d7b7eec69d9088a
