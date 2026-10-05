# Changelog

## [0.1.2](https://github.com/stepupgaming/magenta-windows/compare/v0.1.1...v0.1.2) (2026-10-05)


### Features

* continue the music from a clip, rewind, and fix the attention window ([#4](https://github.com/stepupgaming/magenta-windows/issues/4)) ([5221291](https://github.com/stepupgaming/magenta-windows/commit/52212917f4cf3e77aeb3d89b2aa80706072cd46c))
* **engine:** apply Google's MusicCoCa text mapper to text prompts ([e9df9dd](https://github.com/stepupgaming/magenta-windows/commit/e9df9dd5497edba9b4beb940c28376a26169f81e))
* **engine:** stream audio prompts, cuts, drum modes, onsets, and restarts ([a6fbb9b](https://github.com/stepupgaming/magenta-windows/commit/a6fbb9bc72522a8cf2d800d33c8dd4542e0d2794))
* **engine:** style detail, live choices, scene grooves, and a silence watchdog ([fa0dba8](https://github.com/stepupgaming/magenta-windows/commit/fa0dba80616307e0fd502f471605b74c2a45cae6))
* live-instrument stage, sound library, Google's text mapper, and a faster engine ([ecf2b7e](https://github.com/stepupgaming/magenta-windows/commit/ecf2b7e15d34c8ce61661efb1f585c483a61a875))
* rebuild the stage as a live instrument with a sound library ([7370786](https://github.com/stepupgaming/magenta-windows/commit/7370786eeb63d8fbeb7a249362f00cba403f2ab9))
* show the text mapper state in Settings ([fee8110](https://github.com/stepupgaming/magenta-windows/commit/fee8110adf282f0afa8d821a1d83cf49336a5b06))
* style detail knob, live choices, and scene grooves on the stage ([7484183](https://github.com/stepupgaming/magenta-windows/commit/7484183d2a867a5759c5a3d6664e5ee29af9ba82))


### Bug Fixes

* **engine:** stop each steer from growing GPU memory ([aabdf12](https://github.com/stepupgaming/magenta-windows/commit/aabdf1201af90e382495fc977b7b55bbfc49e264))
* keep held white keys under the black keys ([dea9b33](https://github.com/stepupgaming/magenta-windows/commit/dea9b33617c4f0237791888214931ce09ce1ee79))
* let the web app typecheck studio imports and keep lint green ([c234970](https://github.com/stepupgaming/magenta-windows/commit/c234970c3eae4c21c060152e7ffa34ab4412b480))


### Performance Improvements

* **engine:** halve the per-frame GPU work and make top-k, seed, and memory live ([a890f9d](https://github.com/stepupgaming/magenta-windows/commit/a890f9d4d9bab4675ea5a83c243889215e4abcdf))


### Documentation

* describe style detail, grooves, live choices, and the watchdog ([63fdd0d](https://github.com/stepupgaming/magenta-windows/commit/63fdd0db91fb9a60f6d48a3f34252c5e75d52038))
* describe the new stage, stream protocol, mock engine, and tests ([058cfd3](https://github.com/stepupgaming/magenta-windows/commit/058cfd364ee19eed20d10d78a279e09b3142d030))
* describe the text mapper and engine tests ([bfa01cb](https://github.com/stepupgaming/magenta-windows/commit/bfa01cb18677565d9ae6f7eb33055b1754a4aaa0))

## [0.1.1](https://github.com/stepupgaming/magenta-windows/compare/v0.1.0...v0.1.1) (2026-10-02)


### Features

* publish Magenta.exe on the Windows release ([c643a55](https://github.com/stepupgaming/magenta-windows/commit/c643a55203dbf9f838390b1644a2de00eea99814))


### Bug Fixes

* give the desktop shell a sidebar context for static export ([30188d6](https://github.com/stepupgaming/magenta-windows/commit/30188d6a9e9be038fe9914bad68e5cc4bf7cbe64))
* let the native app typecheck studio imports ([5fc097e](https://github.com/stepupgaming/magenta-windows/commit/5fc097e1f1c995a68f0a45a69f54b4c19fadf528))
