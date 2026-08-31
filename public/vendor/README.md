# Vendored front-end assets

Third-party files served from the instance instead of a public CDN.

## tailwind-3.4.17.min.js

The Tailwind CSS Play CDN build, byte-for-byte what `https://cdn.tailwindcss.com`
redirects to. Tailwind CSS is MIT licensed.

It lives here rather than being fetched at page load because it is a *script*: not a
single utility class exists until it has run, so anything that keeps it from reaching
the browser leaves every page of DVinyl with no layout at all. An ad blocker, a DNS
filter, a company network, or an instance with no outbound internet access are all
enough (issue #133). Served locally, none of that applies.

The runtime config it reads still lives inline in `views/partials/header.ejs`.

To update:

    curl -sL https://cdn.tailwindcss.com/<version> -o public/vendor/tailwind-<version>.min.js

then point `views/partials/header.ejs`, `views/setup.ejs` and `views/login.ejs` at the
new filename and delete the old one. The version is in the filename on purpose: it is
what lets the file be cached hard and still change when it should.

    version  3.4.17
    sha256   176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15
