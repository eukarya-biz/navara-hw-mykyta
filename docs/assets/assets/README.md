# Why there is an `assets/assets` here

`stars.bin` belongs to the stars mesh in Navara's photoreal scene, and unlike the
four scattering LUTs it has no option that reaches it: `atmosphere.atmosphereAssetsUrl`
does not cover it, and updating the `stars` handle after
`addDefaultPhotorealScene()` does not retarget the fetch — verified by watching it
load out of `node_modules/.pnpm/…` in dev while the LUTs came from `public/assets`.

So it resolves against the module that asks for it. In dev that is the package in
`node_modules` and it loads fine; in a build it is the bundle at
`assets/index-<hash>.js`, so the request goes to `assets/assets/atmosphere/stars.bin`.
This directory is that path. It exists so the built page gets the file instead of
the host's 404 page, which is parsed as `Int16Array` and throws on an odd byte
length, taking the atmosphere down with it.

Tied to Vite's default `assetsDir` of `assets`. If that ever changes, this path has
to change with it — and if Navara gains a real option for the stars URL, delete this
directory and use it instead.
