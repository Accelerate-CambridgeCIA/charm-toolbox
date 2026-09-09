# Changelog

## [0.6.3](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/compare/v0.6.2...v0.6.3) (2026-09-09)


### Features

* **CT-330:** a search refuses before running when its winner could not land ([fd68d73](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/fd68d73e479f291d572b642ea24f8d7e844ab53a))
* **CT-331:** mask overlay and brush only paint on the selected panel ([b93b75e](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/b93b75eaf39985b78b516743f9ab239e7e418817))
* **CT-332:** add each picked PNG as a new category of the selected mask layer ([40c21bd](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/40c21bdb847ff2d4f9c9fa58b03844e43e389914))
* **CT-333:** the rop aside names its source panel and switches on request ([26846ce](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/26846ce73b752d32c060cb8e850fe9db736d4c1a))
* **CT-334:** python worker session mode with a resident runner ([888ddff](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/888ddffa3128bd9617d5354fdbe78dcc24d63a29))
* **CT-335:** rop session store uses the resident worker ([c5555e0](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/c5555e00d0d8a8209faca0f8a5ed62114d56ac1f))
* **CT-336:** rop projects in place and the search reuses the resident session ([0e0e350](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/0e0e3504f54deeecdabeb775e656a80c3f6508b0))
* **CT-337:** draw several projections per press ([39a8012](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/39a801221592e7fe0f0887375aab99055e66fad4))
* **CT-338:** shared png chunk writer and 8-bit grayscale png encoder ([195491b](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/195491b460627ab8aae914ea7efdf9d45a6e6e01))
* **CT-339:** png (8-bit) and png stack save single-band sources as grayscale ([59fa0eb](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/59fa0ebce8312deed36a0a62af5ecad987ce84ad))
* **CT-340:** e2e round trip for a threshold png import into masks ([03a58d7](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/03a58d7769dff5b38a5c98dcb30a8116633e4868))
* **CT-341:** concatenate and duplicate renumber bands sequentially ([7d170a9](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/7d170a9282994fc4e4e6dcdf6b7527891b1083e0))
* **CT-342:** per-panel mask overlay visibility flag gates rendering ([1c1791c](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/1c1791c32dc342d64ab21ce93adf3214901e21f6))
* **CT-343:** show masks toggle in the panel header ([0c7c4fe](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/0c7c4fe591dba09c2d0e81e030c09511cb835f84))
* **CT-344:** painting only while the masks tool is active on a visible overlay ([fb3c7c6](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/fb3c7c6108cc9f19db07bd9376a3076eb875b80f))
* **CT-345:** opening any right-side panel closes every other one ([f363007](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/f363007f3a46328747ea3f582421274064da508e))
* **CT-346:** move NPC and CNR to the Tools menu ([07d1b38](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/07d1b388fbdea76174368bada8dd5911e1adb6f4))
* **CT-347:** add dismiss button and 30-second auto-dismiss for non-memory errors ([416b2fd](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/416b2fd885e0a117f7a7cecd03d7dfa8779d3f40))
* **CT-348:** clamp region drags past the image edge to the boundary ([ff34e28](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/ff34e28c6f6906551be0435cf6782940e9c4faaa))
* **CT-349:** custom transform panel names the cube shape as (bands, height, width) ([22ca7a8](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/22ca7a88a6620e151288a19044ec4f96d7e7f255))
* **CT-350:** clip by value accepts a typed negative bound ([ef2609f](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/ef2609f3ffc218a15ef6f0b6fdfaa65cf771b96f))
* **CT-351:** keep the last spectra wavelength tick label inside the plot ([33a8dc4](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/33a8dc44ace8d5613b98f8f8be7e08b275d7aefb))


### Bug Fixes

* **CT-329:** eraser then the same category re-arms mask painting ([4216774](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/4216774cb0cdc1cbe968524727f54583060d8ec8))
* **CT-347:** fix crashing dismiss action and restore green typecheck/lint/tests ([b840577](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/b8405774eae50a574e533ff8dbb8221b1dfd5b27))


### Miscellaneous

* release 0.6.3 ([2d01e76](https://github.com/Accelerate-CambridgeCIA/charm-toolbox/commit/2d01e76148962b9bcdcd08ffbfd7d8fd870b9782))

## [0.6.2](https://github.com/in-scope/charm-toolbox/compare/v0.6.1...v0.6.2) (2026-09-01)


### Features

* **CT-327:** export a mask layer as a zip of per-category pngs ([960a8f8](https://github.com/in-scope/charm-toolbox/commit/960a8f818727c418fa693ecb15ea7bda6a43daea))
* **CT-328:** import a mask from a zip or from several pngs at once ([aa27925](https://github.com/in-scope/charm-toolbox/commit/aa2792559690f5584825cc5aafad77a1fd056939))


### Bug Fixes

* **CT-322:** score cnr as the absolute mean difference over the background spread ([b953839](https://github.com/in-scope/charm-toolbox/commit/b9538392228b03110a0611c86538b7da552048d0))
* **CT-322:** update tests for absolute-value cnr scoring ([c5c4873](https://github.com/in-scope/charm-toolbox/commit/c5c48731ad5c0beaf8d78b181f6aefeb52437e76))
* **CT-323:** reset panel rendering state when replacing its stack ([dc8f04b](https://github.com/in-scope/charm-toolbox/commit/dc8f04b36ef95bd7c8db3178fa5484e987eba056))
* **CT-324:** clamp a result's selected band index to the result raster ([b5d7fbf](https://github.com/in-scope/charm-toolbox/commit/b5d7fbfbd419e66001d5312cc3445b30135e8928))
* **CT-325:** accept 1-, 2-, and 4-bit mask PNGs ([b544818](https://github.com/in-scope/charm-toolbox/commit/b5448183deb1155f4a10bdb294c5d319713deb73))
* **CT-326:** map imported mask pixel values to ascending categories ([b4c8903](https://github.com/in-scope/charm-toolbox/commit/b4c89030ce4e524535426c5b321920edde7b9eb0))


### Miscellaneous

* release 0.6.2 ([c7b0509](https://github.com/in-scope/charm-toolbox/commit/c7b05096ff355b6b19aa3c7c5a7a9f5fa4c1f585))

## [0.6.1](https://github.com/in-scope/ciag-toolbox/compare/v0.6.0...v0.6.1) (2026-09-01)


### Features

* **CT-315:** pin the rop aside to the panel it was opened on ([bedfede](https://github.com/in-scope/ciag-toolbox/commit/bedfedee42c2a83d0cc230e0467a5c4bc3919188))
* **CT-316:** deliver each rop press as a one-band stack in a candidate panel ([5eaaa63](https://github.com/in-scope/ciag-toolbox/commit/5eaaa6363c5ecdb71b8c444f05a88912e95e7644))
* **CT-317:** freeze the candidate panel on keep and deliver search winners frozen ([b3c2824](https://github.com/in-scope/ciag-toolbox/commit/b3c28244102002d96890729756e92f2ea77700f3))
* **CT-318:** score npc per band instead of over the pooled stack ([29ee918](https://github.com/in-scope/ciag-toolbox/commit/29ee918435ead8c731b08e07d18ca4b157bc18ca))
* **CT-319:** show npc per-band scores as a plot and a top-5 list ([87cb537](https://github.com/in-scope/ciag-toolbox/commit/87cb5373cc6128538a6a22a8d83b93fb28bd2df0))
* **CT-320:** add cnr as its own multi-band tool, scored per band ([067e910](https://github.com/in-scope/ciag-toolbox/commit/067e91030e9320ff5a876e8fcdb7407960249684))
* **CT-321:** make the app icon read CHARM beneath the layers symbol ([9e6ada5](https://github.com/in-scope/ciag-toolbox/commit/9e6ada598b29026dcdfe8f24527ec5f3a03653f5))


### Miscellaneous

* pin the demo fixes release to 0.6.1 ([afea41e](https://github.com/in-scope/ciag-toolbox/commit/afea41e4c555f80d6e88d199f28242f0f25fd347))

## [0.6.0](https://github.com/in-scope/ciag-toolbox/compare/v0.5.1...v0.6.0) (2026-08-23)


### Features

* **CT-300:** concatenate two open stacks with matching dimensions ([25443f8](https://github.com/in-scope/ciag-toolbox/commit/25443f8960f691c9deb06ce7a4588a29e86d83ad))
* **CT-301:** duplicate selected bands inside subset bands ([e5bf94c](https://github.com/in-scope/ciag-toolbox/commit/e5bf94cdd0ef2d3e7fd7b75cc3c366bf824ef3d4))
* **CT-302:** add mask layers and the Masks options panel ([445a71e](https://github.com/in-scope/ciag-toolbox/commit/445a71e533ead497fff43fc00cece58fe8c2352f))
* **CT-303:** export and import mask layers as png files with a json sidecar ([25fb8ff](https://github.com/in-scope/ciag-toolbox/commit/25fb8ffb41c085ff05ffb72e01869df191c282b3))
* **CT-304:** paint mask layers with a brush and render them as an overlay ([391844e](https://github.com/in-scope/ciag-toolbox/commit/391844e14b5533d89e5b7ed2b4ffc2ce39f737af))
* **CT-305:** promote a threshold result to a mask category ([f59d8ba](https://github.com/in-scope/ciag-toolbox/commit/f59d8ba2eb8bec197b5b6fcf0d6c3620e430e29f))
* **CT-306:** persist mask layers in the project bundle ([04e375c](https://github.com/in-scope/ciag-toolbox/commit/04e375c25f56811c188945c28cd3bd9cf783bbdc))
* **CT-307:** run built-in client python algorithms with params, masks, wavelengths, and progress ([78cad5c](https://github.com/in-scope/ciag-toolbox/commit/78cad5c9627ef71bac3f504fc366c977437cd7d2))
* **CT-308:** compute an npc score for a mask layer and record it in history ([0e44477](https://github.com/in-scope/ciag-toolbox/commit/0e444773fda6ef79a1e0d4de1cbcbc5abe693d2d))
* **CT-309:** preview random orthogonal projections per press with keep and best-so-far ([f55f065](https://github.com/in-scope/ciag-toolbox/commit/f55f0654a6282f19f0ffa4430db48742a7005b5c))
* **CT-310:** search many random projections in one run and keep the best ([dc308c7](https://github.com/in-scope/ciag-toolbox/commit/dc308c7bf84cde1efb837e930a65abadd9872c10))
* **CT-311:** run local pca over the whole cube with tunable stride, kernel radius, and mean centring ([3789800](https://github.com/in-scope/ciag-toolbox/commit/3789800c252b1b64fb6ae428234f8c3563c45817))
* **CT-312:** add local mnf, the spatially adaptive noise-fraction reduction, to multi-band ([3336d05](https://github.com/in-scope/ciag-toolbox/commit/3336d05bc700a6f6ed0707c550488c33a052bad0))
* **CT-313:** drive the client's l2 binarization approximation from a mask layer ([6f468b2](https://github.com/in-scope/ciag-toolbox/commit/6f468b2e843b97c249e6f3b91c1eca44bda5ee26))
* **masks:** carry mask layers through crop, rotate, and flip instead of dropping them ([6187d68](https://github.com/in-scope/ciag-toolbox/commit/6187d688b45b834effefa17f2c6108b1d9100bee))
* **masks:** show a brush ghost outlining the stamp footprint under the cursor ([95485c9](https://github.com/in-scope/ciag-toolbox/commit/95485c94e416fb40148a92e4f9bf96a997f7c71a))


### Bug Fixes

* **branding:** use a dev-only appusermodelid so the taskbar shows the live window icon ([a0e32ca](https://github.com/in-scope/ciag-toolbox/commit/a0e32cadb4828c52e09f6bf8602c696a71980469))


### Refactors

* **viewport:** remove the fixed [0,1] float view header toggle ([6f9afad](https://github.com/in-scope/ciag-toolbox/commit/6f9afad09804e098a2565b79fdd10f970e848123))

## [0.5.1](https://github.com/in-scope/ciag-toolbox/compare/v0.5.0...v0.5.1) (2026-08-22)


### Features

* **CT-260:** error toasts persist until dismissed ([a2939a9](https://github.com/in-scope/ciag-toolbox/commit/a2939a95bb9ebfaf15daf98d80feae5457a4dd42))
* **CT-263:** grayscale png/jpg images combine into one stack ([ece8532](https://github.com/in-scope/ciag-toolbox/commit/ece8532353d3c8434462cb47e3e16a2179a1d20c))
* **CT-264:** recombine split groups into one stack in the review modal ([9c131b8](https://github.com/in-scope/ciag-toolbox/commit/9c131b8e7cc74eaa71af9992b9941fd1e53a4cd1))
* **CT-265:** right-click selects the panel under the cursor and the link entry explains multi-select ([acdfa23](https://github.com/in-scope/ciag-toolbox/commit/acdfa2380cc80658e5433bf65f305264166c24a7))
* **CT-266:** metadata shows the current data size instead of file size ([1a9ff0b](https://github.com/in-scope/ciag-toolbox/commit/1a9ff0b6bcea796d08bb64457c4e13a51fa0604a))
* **CT-268:** every long operation has a stop button ([dbe9e08](https://github.com/in-scope/ciag-toolbox/commit/dbe9e08af2d86aa2303ce344bf6c703ff2884f4b))
* **CT-269:** applies stay isolated while another operation runs ([47ed54b](https://github.com/in-scope/ciag-toolbox/commit/47ed54b48776513033f2b5179ca042a4fb775d44))
* **CT-271:** 16-bit png export encodes in main through the chunked save protocol ([80f01ca](https://github.com/in-scope/ciag-toolbox/commit/80f01cafb384651fd323ac6c1055e964d1f69d72))
* **CT-272:** 16-bit pngs decode in main to real uint16 samples ([aae629d](https://github.com/in-scope/ciag-toolbox/commit/aae629d7d4980173cc4ca52e23bda22a8cb8b1b8))
* **CT-273:** a stack saves as a folder of pngs, one file per band ([a1feeb1](https://github.com/in-scope/ciag-toolbox/commit/a1feeb1be05a21272aba92bff4cbde42ed0d26c9))
* **CT-274:** open project button in the toolbar ([07cd961](https://github.com/in-scope/ciag-toolbox/commit/07cd96131efe63460515fc1fc535d69dd9aeb3f8))
* **CT-275:** the committed region box drags and resizes ([393a5a6](https://github.com/in-scope/ciag-toolbox/commit/393a5a6e130e848fdc47854d469280cf29d25214))
* **CT-276:** crop to a new panel hints that closing the original frees memory ([d71c4ff](https://github.com/in-scope/ciag-toolbox/commit/d71c4ffd19ca2a4995bfbc6ff6f50c627a502286))
* **CT-277:** the panel toggle names its off state ([af22764](https://github.com/in-scope/ciag-toolbox/commit/af22764c7ab9e6b1509f1e96130c398f0891c519))
* **CT-278:** false-color composite renders in color ([e9fd0dc](https://github.com/in-scope/ciag-toolbox/commit/e9fd0dc052c6c2842b32eb8fbb79cb80c9b6796e))
* **CT-279:** rename reflect to flip in all user-facing labels ([7075839](https://github.com/in-scope/ciag-toolbox/commit/707583988d29af1889bfc2123c2c674d4cb28907))
* **CT-280:** rename spatial filter to frequency filters in user-facing labels ([0ab2bf8](https://github.com/in-scope/ciag-toolbox/commit/0ab2bf839f0210f488dded2a038b2537ff23f966))
* **CT-281:** normalize is min-max only and clip by value stands alone ([a64e935](https://github.com/in-scope/ciag-toolbox/commit/a64e93592f2728bfa9556d620b73a662745cb626))
* **CT-282:** threshold keeps bands and otsu runs as a method through apply ([cbd4963](https://github.com/in-scope/ciag-toolbox/commit/cbd4963d164c1deee338e26b55c2b17a647181f2))
* **CT-283:** subset bands accepts a typed index list ([de39db4](https://github.com/in-scope/ciag-toolbox/commit/de39db4f5125d22eb4cab1046250d7547e1e89b8))
* **CT-284:** band selection folds into subset bands as a by-function mode ([36818e2](https://github.com/in-scope/ciag-toolbox/commit/36818e251c0a10aa3abceb1446f4d57fe85d748b))
* **CT-285:** spectral derivative keeps band count and wavelengths ([3653563](https://github.com/in-scope/ciag-toolbox/commit/3653563f14a662dd0f01e6ca15ab7724aceafbbd))
* **CT-286:** brightness & contrast all-bands description says it works band-wise ([a53cd36](https://github.com/in-scope/ciag-toolbox/commit/a53cd3635d857d69047f8ae3c2a5cd4d2df64b91))
* **CT-287:** one shared band-wise scope field description across tools ([934ea67](https://github.com/in-scope/ciag-toolbox/commit/934ea67ea32d5e5a9855e312f15b86f82e044da8))
* **CT-288:** color tiff variants open in color ([31883d0](https://github.com/in-scope/ciag-toolbox/commit/31883d01cec6ab6500b31bc8dfff5a32a8ba30a4))
* **CT-289:** menus become file, tools, basic-processing, multi-band ([06e204b](https://github.com/in-scope/ciag-toolbox/commit/06e204be5b8e7ceacdeb920ec18762796b25e25c))
* **CT-291:** result destination is a segmented control ([9c8a08f](https://github.com/in-scope/ciag-toolbox/commit/9c8a08fcfb3e889819349764a3599d43ac163317))
* **CT-292:** rename false-color composite to rgb color composite with a venn icon ([791650d](https://github.com/in-scope/ciag-toolbox/commit/791650d9ac64cecb7adb9b640a32406a7411e0eb))
* **CT-293:** by-function modes are exclusive and run on apply ([1eefa7f](https://github.com/in-scope/ciag-toolbox/commit/1eefa7f1e20740a84cdf2e7c4997d32c3dab21a5))
* **CT-295:** channel-view toggle is the rgb color composite toggle ([60507cf](https://github.com/in-scope/ciag-toolbox/commit/60507cf7773e478f08d5100ecd78156c2a66bc5d))
* **CT-298:** rename the app to charm toolbox ([f5355c7](https://github.com/in-scope/ciag-toolbox/commit/f5355c76da6a6330f3eb1a47e8785da187f305d5))
* **CT-299:** custom transform may return any spatial size ([cca3cdf](https://github.com/in-scope/ciag-toolbox/commit/cca3cdfae1d55f0ab94e046026be7c1c7da52640))


### Bug Fixes

* **CT-261:** clear the operation region on apply failure, panel switch, and cancel ([51dd6e9](https://github.com/in-scope/ciag-toolbox/commit/51dd6e9d27ab7945b19a37705a4ba55de6d01399))
* **CT-262:** guarantee the bundled python runtime ships in packaged builds ([3261757](https://github.com/in-scope/ciag-toolbox/commit/32617574925b84102da5c6ceae0738f070de539d))
* **CT-269:** panel close button stays clickable above the busy overlay ([de0ae49](https://github.com/in-scope/ciag-toolbox/commit/de0ae49c18e5c4cc85ead219f0e8350079b0aba0))
* **CT-290:** repeated large applies never exhaust memory ([96eae86](https://github.com/in-scope/ciag-toolbox/commit/96eae861ac3131904ac84f8f39f68b1e25403c81))
* **CT-296:** png and jpeg exports save the image as viewed ([63e7636](https://github.com/in-scope/ciag-toolbox/commit/63e763648e6cf91cb18b4ede70cc001fb0d23b9b))
* **CT-297:** contrast centres on the middle of the data range ([cae7037](https://github.com/in-scope/ciag-toolbox/commit/cae70374bad0013e7bb791715fdc6158cbae4e69))


### Performance Improvements

* **CT-267:** rotate and flip run tight per-band loops and finish in seconds at the anna benchmark ([5d2131e](https://github.com/in-scope/ciag-toolbox/commit/5d2131ef493c70c557de65dd0d7e86fcb5e127a9))
* **CT-270:** pca, mnf and ica meet wall-clock targets at the anna benchmark ([973dd94](https://github.com/in-scope/ciag-toolbox/commit/973dd9427df9133ac2c7ba7c3ff49f53c8a20058))

## [0.5.0](https://github.com/in-scope/ciag-toolbox/compare/v0.4.3...v0.5.0) (2026-07-27)


### Features

* **CT-200:** manual threshold with live preview and binary-stack output ([69303a1](https://github.com/in-scope/ciag-toolbox/commit/69303a164837d356a9eb1a8ede8cf49843ad6a61))
* **CT-201:** otsu auto threshold with per-band cutoffs ([003000d](https://github.com/in-scope/ciag-toolbox/commit/003000d5cf605fced80d4b05c2cc1de2c382d4f5))
* **CT-202:** spectral derivative with first and second order ([2e90b84](https://github.com/in-scope/ciag-toolbox/commit/2e90b84a66bdf6608d2ff525ee93b270ae7754e5))
* **CT-203:** spatial frequency filters with pure ts fft and butterworth ([7badbb0](https://github.com/in-scope/ciag-toolbox/commit/7badbb0003ae0209a4a1ebc57484f7055e8ea227))
* **CT-204:** denoising with gaussian and median filters ([2548ee6](https://github.com/in-scope/ciag-toolbox/commit/2548ee6eddd919f1d28f7f507417a6c72da7457b))
* **CT-205:** percentile clip with scope-dependent cut points ([8c20ba2](https://github.com/in-scope/ciag-toolbox/commit/8c20ba2bd2e3cb26510f9dcad44edad4fd9bafcd))
* **CT-207:** linked pan and zoom across panel groups ([42e207e](https://github.com/in-scope/ciag-toolbox/commit/42e207ec6c7751c7436c2c612c160e16d5afbde5))
* **CT-208a:** bundled python runtime, resolver, and subprocess worker harness ([b5428a8](https://github.com/in-scope/ciag-toolbox/commit/b5428a8c1f4b6acddcf11d1c0243d87f07f3358f))
* **CT-208b:** cube ipc contract, inline formula mode, and return-type validation ([0e0c8ad](https://github.com/in-scope/ciag-toolbox/commit/0e0c8ad399f2fd2367831570bd86ab5281e2edf4))
* **CT-208c:** imported .py/.zip script flow ([27df8cc](https://github.com/in-scope/ciag-toolbox/commit/27df8ccf597c6a3ca81f3154b64e85a4c7c97de4))
* **CT-208d:** bundled-mode sandbox for user scripts ([1531015](https://github.com/in-scope/ciag-toolbox/commit/1531015be2a74cdea2c5a6aff39cf56de5d13bb6))
* **CT-208e:** own-environment mode for user scripts ([f3060b4](https://github.com/in-scope/ciag-toolbox/commit/f3060b4292cede2775e421a3d7931d12539eaaa3))
* **CT-208f:** in-app how-to-write-a-custom-script docs page ([77ada5d](https://github.com/in-scope/ciag-toolbox/commit/77ada5d7c537f0a35ad24c9710c14ad65fbe7671))
* **CT-209:** band weighting (linear combination) gated behind the scripting worker ([967cdd6](https://github.com/in-scope/ciag-toolbox/commit/967cdd6f6f737ac11748b9fd0d43823dbd4fdeea))
* **CT-210:** band selection by function gated behind the scripting worker ([87cc1e8](https://github.com/in-scope/ciag-toolbox/commit/87cc1e827abc217644faaf93dc4a66e1b3af9771))
* **CT-214:** cube-result response frame in the worker protocol ([5c883c4](https://github.com/in-scope/ciag-toolbox/commit/5c883c44fe35c8f73b651788e48175ac6821645f))
* **CT-215:** cube-transform return contract and metadata carry-through ([cd4439c](https://github.com/in-scope/ciag-toolbox/commit/cd4439c711afdd2afa592c030d57bb0a91562c60))
* **CT-216:** custom transform operation running a user script over the whole cube ([cc857ce](https://github.com/in-scope/ciag-toolbox/commit/cc857ce9b96d40d2b1c0c23236927546c0b49ceb))
* **CT-217:** hosted scripting doc and template scripts ([6099185](https://github.com/in-scope/ciag-toolbox/commit/60991856a1127f5a2efb5c138bd0ab8111028a8e))
* **CT-218:** replace the in-app docs page with links to the github doc ([32a35bb](https://github.com/in-scope/ciag-toolbox/commit/32a35bbca343321225b2328a43598e6f64c7b559))
* **CT-220:** percentage progress for long-running file loads ([99d5885](https://github.com/in-scope/ciag-toolbox/commit/99d588537460cb96bfff56961d561d15d2db2809))
* **CT-221:** determinate per-band progress for slow operations ([c3d46b7](https://github.com/in-scope/ciag-toolbox/commit/c3d46b7461c8d48ae47eb4c8b9ff6b5ab3d88804))
* **CT-222:** determinate progress for the remaining per-band operations ([256855c](https://github.com/in-scope/ciag-toolbox/commit/256855c5bc2726b4d42ca1d00e7ee1bdccdc5c1b))
* **CT-223:** phase-based progress for pca, ica, and mnf ([7e4745b](https://github.com/in-scope/ciag-toolbox/commit/7e4745b33150df0eedb2f0b3ae35c0a48200f5bf))
* **CT-225:** within-band progress for the spatial filter ([7d78801](https://github.com/in-scope/ciag-toolbox/commit/7d78801b9f577db2fcc34c8048b353770a3e6fa1))
* **CT-226:** within-band chunked progress for denoise ([3be3a0a](https://github.com/in-scope/ciag-toolbox/commit/3be3a0ab7c5d0144bcff642f44cc78629af614c0))
* **CT-227:** within-fit progress for pca, mnf, and ica ([b07c5c8](https://github.com/in-scope/ciag-toolbox/commit/b07c5c8263c297050d5b1a83e077944711eb8d41))
* **CT-228:** opt-out e2e traces with per-run archiving, storyboard steps, and html report ([a87df2a](https://github.com/in-scope/ciag-toolbox/commit/a87df2aa7e9610488818524e75ff5e8b65fe65df))
* **CT-230:** add streaming scale10 fixture generator with shared tiff/envi writers ([5c9df1c](https://github.com/in-scope/ciag-toolbox/commit/5c9df1c708359071cb151054fedfe77c82386661))
* **CT-235:** chunk the project-save asset encode and lift the 1.8 gb bake cap ([bf893ce](https://github.com/in-scope/ciag-toolbox/commit/bf893ce6086058f26fe2ba49eeb567a123ce8ff5))
* **CT-237:** chunk the save-image ipc and refuse tiff export past 4 gb ([05f6842](https://github.com/in-scope/ciag-toolbox/commit/05f684283428b25b4ca95b3b5c53fdd080f2a3f8))
* **CT-238:** add the scale10 load-display sweep spec and support module ([7fc298e](https://github.com/in-scope/ciag-toolbox/commit/7fc298ef494369c892bec23a29cd9b498612ca45))
* **CT-239:** add the scale10 operations sweep and the renderer memory-budget guard ([0ac89fe](https://github.com/in-scope/ciag-toolbox/commit/0ac89fea95e3a3eeb464e509ce3ad3fee1698397))
* **CT-240:** add the scale10 reduction sweep and stream the dimension-reduction fits ([c83c42e](https://github.com/in-scope/ciag-toolbox/commit/c83c42e8ce7b3120bdfc060b0c140dd21afbad5e))
* **CT-241:** scale10 python sweep with uint64 cube frames, scaled timeouts, and the worker memory gate ([389daaa](https://github.com/in-scope/ciag-toolbox/commit/389daaaae28898dad6ca8843541d5c11e2a3ab5a))
* **CT-243:** remove the roi scope from bit shift ([7f85aa5](https://github.com/in-scope/ciag-toolbox/commit/7f85aa52aed1f9abb6d627f5b7ef7541d40d02e1))
* **CT-244:** remove the roi scope from the tone curve ([64cf620](https://github.com/in-scope/ciag-toolbox/commit/64cf620eca52c21990e543d82adaef4a6d90bd76))
* **CT-245:** rename tone curve to contrast curve in user-facing text ([437f122](https://github.com/in-scope/ciag-toolbox/commit/437f12201e16b694cf4f08ea36bc3f16d310a3cd))
* **CT-246:** rename the curve anchor fields to original value / new value ([07f2f14](https://github.com/in-scope/ciag-toolbox/commit/07f2f1478e073ad88048baaaa5bde57afb5ccaf3))
* **CT-247:** live brightness & contrast preview and all-channel apply for color photos ([2c243da](https://github.com/in-scope/ciag-toolbox/commit/2c243da5ed591b60260014c889a4ce8c4652cd4f))
* **CT-248:** view a color photo as scrollable channels ([70060ce](https://github.com/in-scope/ciag-toolbox/commit/70060ce8a63aedef8da4a8a83811c3fb77e047e1))
* **CT-249:** copy fixes for rgb to grayscale and bit shift ([212dec7](https://github.com/in-scope/ciag-toolbox/commit/212dec70f2eba16a3d01e6ce4c3da4f8eb2d7f6d))
* **CT-250:** normalize copy overhaul with anna's method names and clip wording ([fc57b8a](https://github.com/in-scope/ciag-toolbox/commit/fc57b8a88a435a4c1a53c8bfbf50e2f5ce8bf354))
* **CT-251:** empty band field means all bands in every band-wise operation ([d4f7e53](https://github.com/in-scope/ciag-toolbox/commit/d4f7e53b0d845f632c35bfe9519b0fb48872c54d))
* **CT-252:** open bands separately physically splits the group in the review modal ([3ed06b8](https://github.com/in-scope/ciag-toolbox/commit/3ed06b8a86f7735fbb83f6cb31ec316f543c4518))
* **CT-253:** band navigator wraps from the last band to the first ([47ec6ac](https://github.com/in-scope/ciag-toolbox/commit/47ec6ac7566a260134deccc8f5e92593e4408526))
* **CT-254:** band removal asks for confirmation before deleting ([de45f20](https://github.com/in-scope/ciag-toolbox/commit/de45f20dd044c383d53cca6f1aa89618482b1a2b))
* **CT-255:** suppress the histogram zero tick when it would collide with the edge labels ([9927795](https://github.com/in-scope/ciag-toolbox/commit/992779550018e0eae6130ad31bb17e65e3785cb6))
* **CT-256:** the histogram follows the active region with a region badge ([b427127](https://github.com/in-scope/ciag-toolbox/commit/b427127472e1fa5ff14c5a7f5418305ffa679e20))
* **CT-257:** contrast reaches 20x on a log-symmetric slider ([2bfebff](https://github.com/in-scope/ciag-toolbox/commit/2bfebffcb03e09c0b17f1f1dab07b7c1e0e262e1))
* **CT-258:** ask to save the project when closing with unsaved work ([f283f0b](https://github.com/in-scope/ciag-toolbox/commit/f283f0b2fa3cc1deb9b5f1bd0f7387db58233e7a))
* **CT-259:** the fixed [0,1] float view tooltip explains both states ([f92c205](https://github.com/in-scope/ciag-toolbox/commit/f92c2059491ccb14f04d20edc2feb36790f70328))
* **custom-transform:** run the python at apply and keep the panel open on failure ([8690cb5](https://github.com/in-scope/ciag-toolbox/commit/8690cb5485fbc3c70406efffd2d46dc42c6ff9a0))
* **menus:** flatten operation menus to alphabetical lists without separators ([96d4ae3](https://github.com/in-scope/ciag-toolbox/commit/96d4ae3b9191f7406113050e362dfce03f60cbc2))
* **menus:** split image menu into image/adjust/process/spectral and trim toolbar to shortcut allowlist ([14b6aec](https://github.com/in-scope/ciag-toolbox/commit/14b6aec65f0f4ada3034cd63740030d31f526aa0))
* **python:** blocked-import copy points at view &gt; python environment, with bundled-refusal and own-environment tests ([41b9dab](https://github.com/in-scope/ciag-toolbox/commit/41b9dab7e8dc85b4470bfad29217ccbf0f74a0f0))
* **python:** bundle the script-facing packages from wallace's sample environments with pinned versions documented ([2ceb457](https://github.com/in-scope/ciag-toolbox/commit/2ceb45739ead1fdffbb1b27c3e395bab3aba342b))


### Bug Fixes

* **CT-219a:** float32 reused fft grids, pre-flight size check, and worker-backed spatial filter ([f3cd71c](https://github.com/in-scope/ciag-toolbox/commit/f3cd71c79026ca9d15e9f315b868ae6a4a272856))
* **CT-219b:** chunk open-file reads so gigabyte tiffs stop killing the main process ([4959884](https://github.com/in-scope/ciag-toolbox/commit/49598842fdadc43f611c8ddc3d967ce33f268c9b))
* **CT-219c:** compute full-stack percentile cut points without concatenating the stack ([4a4c9da](https://github.com/in-scope/ciag-toolbox/commit/4a4c9da084b754b50a29589e31b212f0c57a09e9))
* **CT-219d:** derive otsu auto cutoffs without concatenating the stack ([623aec0](https://github.com/in-scope/ciag-toolbox/commit/623aec005d698e8b2acc02770e9b62aa1f39d8e2))
* **CT-219e:** chunk and spool the project-save asset transfer so saves survive reference scale ([d4a87e6](https://github.com/in-scope/ciag-toolbox/commit/d4a87e6cce48f802dd84f28e41a466aeb37024c1))
* **CT-219f:** chunk the tiff and envi export encodes with determinate save progress ([fb365fd](https://github.com/in-scope/ciag-toolbox/commit/fb365fd0772863b889542a70f35921ae54d6b434))
* **CT-219g:** chunk and spool the user-script cube transfer so runs survive reference scale ([40e4f14](https://github.com/in-scope/ciag-toolbox/commit/40e4f1414400baca07d6338e725f57a61d43a26a))
* **CT-224:** mixed-radix fft padding so large captures pass the spatial filter grid limit ([8069c99](https://github.com/in-scope/ciag-toolbox/commit/8069c99f67e6817219ecfbc4a3ed13a390a64515))
* **CT-231:** stream envi decode from chunked reads without a whole-file buffer ([8fb8080](https://github.com/in-scope/ciag-toolbox/commit/8fb808018f1e8ea19216e9075b195deb9ce96226))
* **CT-232:** drop raw file byte retention from the open-images grouping path ([d8380ae](https://github.com/in-scope/ciag-toolbox/commit/d8380ae8437a36df3c7b5bb2c5bd6ba9d1e4e826))
* **CT-233:** remove the unconditional apply-time cube clone ([fa4bad5](https://github.com/in-scope/ciag-toolbox/commit/fa4bad5b60b3e5368a7b30375efc9592810b5fbf))
* **CT-234:** chunk the legacy single-reply open paths for re-import and reference pick ([ca45088](https://github.com/in-scope/ciag-toolbox/commit/ca450889c07e6faf58efa2c269487820065386e2))
* **CT-236:** chunk the project-reopen asset read ([b899a82](https://github.com/in-scope/ciag-toolbox/commit/b899a82cf4ff3660034d7facbfbbc62dfa159d54))

## [0.4.3](https://github.com/in-scope/ciag-toolbox/compare/v0.4.2...v0.4.3) (2026-07-03)


### Bug Fixes

* **webgl:** store float raster tiles in r32f so out-of-half-float components display correctly ([c5566b0](https://github.com/in-scope/ciag-toolbox/commit/c5566b0167bddd0721c64f5a16c1eee3d511e2f4))
* **webgl:** store float raster tiles in R32F so out-of-half-float components display correctly ([27fbbdd](https://github.com/in-scope/ciag-toolbox/commit/27fbbdd52b3feb9df96d426212be713077c31710))

## [0.4.2](https://github.com/in-scope/ciag-toolbox/compare/v0.4.1...v0.4.2) (2026-06-25)


### Features

* **CT-199:** editable endpoint input with gimp black/white-point semantics ([ebbc343](https://github.com/in-scope/ciag-toolbox/commit/ebbc343ad24cf770d802cb11178027f40e738b69))


### Bug Fixes

* **CT-198:** float tone curve opens as a true no-op identity ([0d1da73](https://github.com/in-scope/ciag-toolbox/commit/0d1da73b422977b3f4ede3263b61a6c708ea7d15))


### Miscellaneous

* release 0.4.2 ([42e469d](https://github.com/in-scope/ciag-toolbox/commit/42e469d6beb540ae27d85f166f4fe00e9967f06a))

## [0.4.1](https://github.com/in-scope/ciag-toolbox/compare/v0.4.0...v0.4.1) (2026-06-25)


### Bug Fixes

* **CT-196:** preserve wide integer-container values on 16-bit TIFF save ([522165f](https://github.com/in-scope/ciag-toolbox/commit/522165fbc5243e5355514fa798c8804f0da39fe9))
* **CT-196:** preserve wide integer-container values on 16-bit TIFF save ([8f84485](https://github.com/in-scope/ciag-toolbox/commit/8f84485dfaca28239b6da87a24e7a26e1540adcd))

## [0.4.0](https://github.com/in-scope/ciag-toolbox/compare/v0.3.1...v0.4.0) (2026-06-23)


### Features

* **CT-180:** add shared dimension-reduction operation infrastructure ([bd18a78](https://github.com/in-scope/ciag-toolbox/commit/bd18a78bc9fe03187850cd0fb480cb8ffddfde54))
* **CT-181:** add PCA transform with per-component variance readout ([d01426d](https://github.com/in-scope/ciag-toolbox/commit/d01426d3610ae353ad437ea96ad44f55cec0ac72))
* **CT-182:** add ROI-fit-then-apply-to-whole for dimension-reduction transforms ([6c8aab3](https://github.com/in-scope/ciag-toolbox/commit/6c8aab3b5f306395bb7ab8eff068d118ddb51043))
* **CT-183:** add MNF transform with per-component noise-fraction readout ([d9ef373](https://github.com/in-scope/ciag-toolbox/commit/d9ef3732b01870383b0cd0d1902ffe5d4b5273ba))
* **CT-184:** add ICA transform with deterministic FastICA and recovered-source ordering ([2ad0062](https://github.com/in-scope/ciag-toolbox/commit/2ad0062db791fb67f0598008ffa926befbdf1db9))
* **CT-186:** add live display-only preview for brightness/contrast sliders ([b5366e8](https://github.com/in-scope/ciag-toolbox/commit/b5366e870938fcc448e137e8f914498e251b3799))
* **CT-187:** document band-range syntax in band-wise tool help text ([d6ed9e8](https://github.com/in-scope/ciag-toolbox/commit/d6ed9e80bf80d80d9fc2398fda5f2b98b4824d95))
* **CT-188:** clear pinned spectra when cropping ([bf5e01d](https://github.com/in-scope/ciag-toolbox/commit/bf5e01d0716c548e09e8be71885f85248ac95efc))
* **CT-189:** hide scope selector on single-band stacks ([307a2b9](https://github.com/in-scope/ciag-toolbox/commit/307a2b9b1ba146a829f297d473478015e9a016d2))
* **CT-190:** reject RGB-to-grayscale on non-RGB input before opening a panel ([96f78ce](https://github.com/in-scope/ciag-toolbox/commit/96f78cef7112ba6a58545db7995aed14cec4180f))
* **CT-192:** add whole-stack scope to the tone curve (one curve, all bands) ([736ad06](https://github.com/in-scope/ciag-toolbox/commit/736ad06d98bddd4123f06a8c4a2b07a255f8efd2))
* **CT-193:** add per-panel fixed [0,1] float view toggle ([5c6dc62](https://github.com/in-scope/ciag-toolbox/commit/5c6dc628540fd65f661f0b07f770e44d4b242587))
* **CT-194:** add clip by value (absolute) method to normalize ([7046ee2](https://github.com/in-scope/ciag-toolbox/commit/7046ee21c7a15dd5f7867ff6590c9f1c792425f0))


### Bug Fixes

* **CT-185b:** read pixel values under floating panel overlays ([1482d51](https://github.com/in-scope/ciag-toolbox/commit/1482d51f35de933750e41d687b59d3145210480a))
* **CT-185c:** exclude the band-navigator overlay from the canvas brightness oracle ([f4ce651](https://github.com/in-scope/ciag-toolbox/commit/f4ce651fc81ce87d879f82e730995a96c56303e1))
* **CT-195:** scale MNF components to unit length so they fit the half-float display texture ([7998b0d](https://github.com/in-scope/ciag-toolbox/commit/7998b0d6cebc30631937b8b4eec23f85e5279a66))
* **CT-195:** stream MNF shift-difference noise covariance so large stacks don't OOM the renderer ([319b053](https://github.com/in-scope/ciag-toolbox/commit/319b0538d31aee56f203a0b76e3e6d2313d50d83))


### Miscellaneous

* release 0.4.0 ([30eae5e](https://github.com/in-scope/ciag-toolbox/commit/30eae5ee330cbb61ec42f50ebba153f3a551e999))

## [0.3.1](https://github.com/in-scope/ciag-toolbox/compare/v0.3.0...v0.3.1) (2026-06-16)


### Features

* **CT-164:** track and highlight the selected tone-curve anchor ([ad61c4a](https://github.com/in-scope/ciag-toolbox/commit/ad61c4a830a4fffe0551a24d0e4bbfe9e301b8b4))
* **CT-165:** add numeric input/output fields with steppers for the selected tone-curve anchor ([8e87016](https://github.com/in-scope/ciag-toolbox/commit/8e870160437a6eb2dfa12ec7f8929e217a25c3a3))
* **CT-166:** add keyboard nudge and delete for the selected tone-curve anchor ([79a0259](https://github.com/in-scope/ciag-toolbox/commit/79a02598eaf43c22cc3c780eb982f4d305b2e858))
* **CT-167:** reset tone curve to the identity diagonal ([909beca](https://github.com/in-scope/ciag-toolbox/commit/909becafd5527252ffe1bafd1a9b8952db154046))
* **CT-168:** add an 8x8 reference grid behind the tone curve ([8a849e3](https://github.com/in-scope/ciag-toolbox/commit/8a849e3283f6431b67a9fe72bb7303193be3db60))
* **CT-169:** add consolidated tone-curve behaviour regression and reconcile e2e coverage ([597ad15](https://github.com/in-scope/ciag-toolbox/commit/597ad15e74850694d6a06098b2e511853fe499a0))
* **CT-170:** add tone-curve LUT texture and shader sampling ([86cb890](https://github.com/in-scope/ciag-toolbox/commit/86cb89027b51f79874028272ec15835de355916d))
* **CT-171:** switch tone-curve preview to the GPU LUT (display-only) ([d9a9b0d](https://github.com/in-scope/ciag-toolbox/commit/d9a9b0da403b7f7fbd505bb10060a245496d4797))
* **CT-172:** promote browser-decoded photos to rasters at load ([9983690](https://github.com/in-scope/ciag-toolbox/commit/9983690131745400840e0ab3e19647a828e988d5))
* **CT-173:** re-gate photo export rules on colour interpretation ([ef695b4](https://github.com/in-scope/ciag-toolbox/commit/ef695b46766f75e6e2c607da50efedeffb923833))
* **CT-174:** persist colour interpretation through project bundles ([0ed21c0](https://github.com/in-scope/ciag-toolbox/commit/0ed21c0e989345dc7e832e06357f25b65f730120))
* **CT-175:** add per-channel tone-curve model and backward-compatible apply serialization ([b026bbd](https://github.com/in-scope/ciag-toolbox/commit/b026bbd798560e1fe69c5c2a415d8f7c7d11eb14))
* **CT-176:** add in-panel RGB/R/G/B tone-curve channel selector for composites ([2eddf5f](https://github.com/in-scope/ciag-toolbox/commit/2eddf5faa4d18c4adb21755e93cdeae6bd408305))
* **CT-177:** preview per-channel tone curves on the gpu for composites ([597d0f8](https://github.com/in-scope/ciag-toolbox/commit/597d0f879f440264351479b37f095517ea118442))
* **CT-178:** bake per-channel tone curves into a composite in one operation ([09c29d1](https://github.com/in-scope/ciag-toolbox/commit/09c29d1b6094f18301bcc8f5da2c0a746825380f))
* **CT-179:** reconcile tone-curve specs and add a consolidated photo regression ([9968e2f](https://github.com/in-scope/ciag-toolbox/commit/9968e2f42d2d3b6f00c32844cb7f41500c7002d8))
* stage-3 toolbox - per-channel tone curves, true-colour images, float auto-fit ([b0c44a5](https://github.com/in-scope/ciag-toolbox/commit/b0c44a596ea6d7606a0ad045265fbf2d831822ba))


### Miscellaneous

* release 0.3.1 ([476dcaf](https://github.com/in-scope/ciag-toolbox/commit/476dcaf46dd080af33251e279d91d5ec5e1db18f))

## [0.3.0](https://github.com/in-scope/ciag-toolbox/compare/v0.2.1...v0.3.0) (2026-06-15)


### Features

* **CT-076:** add shared full-cube vs band-wise scope parameter kind ([59954d3](https://github.com/in-scope/ciag-toolbox/commit/59954d39df59bbe5c370f0a1db17492645415017))
* **CT-077:** add shared makeFloatRasterFromBandComputation helper for float32 output ([af2e13f](https://github.com/in-scope/ciag-toolbox/commit/af2e13f168d031a6a009a1511ab5a655dbeb6546))
* **CT-078:** add flat-field correction with light/dark reference cubes ([acac2de](https://github.com/in-scope/ciag-toolbox/commit/acac2ded496604f4953d2f27bc29db8e2f6d390c))
* **CT-079:** add Spectralon reflectance calibration from a bright-target ROI ([c9a5bdf](https://github.com/in-scope/ciag-toolbox/commit/c9a5bdf2e450add2700307fbb6a5bb4d0de18f0c))
* **CT-080:** add histogram black/white-point contrast stretch ([f052168](https://github.com/in-scope/ciag-toolbox/commit/f0521683d606dae33f259fbcf65e7c07365ed0e0))
* **CT-081:** add brightness and contrast sliders as a data-changing band operation ([482a6ea](https://github.com/in-scope/ciag-toolbox/commit/482a6eaab1902c359321cf1902af40c584efd819))
* **CT-082:** add invert with a bounded-data-range guard ([95d7f37](https://github.com/in-scope/ciag-toolbox/commit/95d7f37ae026dcd0de2836e64f0d0c62d76adee2))
* **CT-083:** add data-changing linear normalize with full-cube and band-wise scope ([89c927c](https://github.com/in-scope/ciag-toolbox/commit/89c927c2da5143c6a6fcf21b9646e7629fcab4d4))
* **CT-084:** add standardize to target mean and std with full-cube and band-wise scope ([a5eaad8](https://github.com/in-scope/ciag-toolbox/commit/a5eaad88360460e24503cf472b48d09b432896ab))
* **CT-085:** convert 3-band RGB to a single grayscale band with luminance or custom weights ([f25e11b](https://github.com/in-scope/ciag-toolbox/commit/f25e11b825d31c4e97b1f5f1ab5b1fc09f0f04a2))
* **CT-086:** add false-color composite from three bands with live preview ([29c1343](https://github.com/in-scope/ciag-toolbox/commit/29c134306f394a2145c7e1388cd02a2294c14113))
* **CT-087:** add rotate (90/180/270 cw) and horizontal/vertical flip for the whole cube ([1519d30](https://github.com/in-scope/ciag-toolbox/commit/1519d3056a6a02686f0eed7d91fd2ef3997fbc3b))
* **CT-088:** persist the last two ROI spectra (mean +/- 1 sigma) on the spectra chart ([b23e267](https://github.com/in-scope/ciag-toolbox/commit/b23e267a13b884163cad3c3d6fe104b4c2503d55))
* **CT-090:** break spectra line/ribbon at removed middle bands instead of interpolating ([6ac2e58](https://github.com/in-scope/ciag-toolbox/commit/6ac2e584fc956f6ccf113a90b2fcd3839f17d77e))
* **CT-091:** remove a single band via an x in the band navigator, reusing the subset backend ([05794f4](https://github.com/in-scope/ciag-toolbox/commit/05794f4e893b905e52402d5745c638922b842ba8))
* **CT-092:** declutter right panel - drop bands list and pixel inspector, add live hover spectrum ([80130c4](https://github.com/in-scope/ciag-toolbox/commit/80130c4d5a46ca1e2a60ba1c44e5d9d3524a70d3))
* **CT-093:** re-home original band index/wavelength to metadata panel and history ([3149950](https://github.com/in-scope/ciag-toolbox/commit/3149950eb84129ed3059489d61a61b84effb21c3))
* **CT-094:** track the active band in the top panel header label ([b76ae0d](https://github.com/in-scope/ciag-toolbox/commit/b76ae0dce35d4e26b677195cadb2d412ce677cee))
* **CT-095:** request a per-operation region instead of consuming the inspection roi ([5756917](https://github.com/in-scope/ciag-toolbox/commit/5756917e1aea10aae9bde1fc56f23014bda9d8cc))
* **CT-096:** clear roi on tool deselect or outside click and stop stray selection markers ([ec7417d](https://github.com/in-scope/ciag-toolbox/commit/ec7417d427f7dcea4df63818eff568e4c00c6539))
* **CT-097:** auto-normalize then invert unbounded data, emitting both outputs ([045fb18](https://github.com/in-scope/ciag-toolbox/commit/045fb18894d3756f7d8aeb9082fe611333d3c629))
* **CT-098:** add pure monotone tone-curve engine subsuming black/white-point stretch ([80eb6b8](https://github.com/in-scope/ciag-toolbox/commit/80eb6b8d7319a544d52e6f6e56ed964a0c54e23b))
* **CT-099:** replace black/white markers with interactive multi-anchor tone-curve editor and live preview ([4941ade](https://github.com/in-scope/ciag-toolbox/commit/4941ade87dc2b5a355a3c31046a5f024a2109b2e))
* **CT-100:** superscript axis magnitudes, histogram count y-axis, and seamless bars ([577ea6f](https://github.com/in-scope/ciag-toolbox/commit/577ea6f62c17dcef56fcd571fd0d0cb135a6afae))
* **CT-101:** user-facing terminology sweep to band/stack/image/panel ([ed5744a](https://github.com/in-scope/ciag-toolbox/commit/ed5744a3cb040ef50e73cc403e819f21e8f28583))
* **CT-106:** show immediate, operation-specific loading state in new result panels ([f786f0b](https://github.com/in-scope/ciag-toolbox/commit/f786f0b541a051cf75145d52399018d82e2f46cd))
* **CT-107:** add robust percentile normalize option for outlier-fragile captures ([d357f97](https://github.com/in-scope/ciag-toolbox/commit/d357f97ff097a39723e5005db45aa181b3824562))
* **CT-108:** add spectra hover tooltip with per-band value crosshair ([7a36bcb](https://github.com/in-scope/ciag-toolbox/commit/7a36bcbf140b1e310f0d30508f8be3d22b585895))
* **CT-109:** auto-promote browser-decoded images to rasters so operations accept JPG/PNG ([e8c5a37](https://github.com/in-scope/ciag-toolbox/commit/e8c5a37cf8ed743fc0ab237d21fd2c7a75f59f4b))
* **CT-110:** replace band-wise scope with a band-range text input defaulting to the current band ([4b4c476](https://github.com/in-scope/ciag-toolbox/commit/4b4c4760c2cb66f8217c8845d89b4c659f0d308f))
* **CT-111:** broadcast single-band flat-field references and allow loaded panels as references ([0efd7b9](https://github.com/in-scope/ciag-toolbox/commit/0efd7b9d972d2b4b8f95785d308e48f38c0b4448))
* **CT-112:** add playwright electron harness with dev-server launch helper and smoke spec ([6588906](https://github.com/in-scope/ciag-toolbox/commit/65889065fe849f1cec3e4b0e98447d880b63833e))
* **CT-113:** add env-gated test-mode file-dialog stub and preload bridge ([347ef49](https://github.com/in-scope/ciag-toolbox/commit/347ef490bd5d330566c7664251898e9c8f6579f3))
* **CT-114:** add deterministic e2e fixture set with documented manifest ([e4a622a](https://github.com/in-scope/ciag-toolbox/commit/e4a622a7f211093c40fc5d4490ed12b46cd641d2))
* **CT-115:** add e2e page objects, readbacks, and status-bar test hooks ([b634cdb](https://github.com/in-scope/ciag-toolbox/commit/b634cdbf51d9f7f8ceebdccc5075eccf1005a415))
* **CT-116:** add operation/history/readout assertion utilities ([39877dd](https://github.com/in-scope/ciag-toolbox/commit/39877dd93cf256c8ecaa1671266ce1ee6e50ea40))
* **CT-117:** add main window shell, menus, and About dialog e2e spec ([c2d3f20](https://github.com/in-scope/ciag-toolbox/commit/c2d3f208884ff56a86e06aa9a36cdce50539eb4c))
* **CT-118:** add toolbar presence, accessible-name, and disabled-state e2e spec ([2d343ef](https://github.com/in-scope/ciag-toolbox/commit/2d343efe58a916b85b1b7c0c001d9632f0fe1dc3))
* **CT-119:** add webgl viewport render, non-blank, and context-loss e2e spec ([6543cc0](https://github.com/in-scope/ciag-toolbox/commit/6543cc00af2868961384b2cf5c801d8defc2c386))
* **CT-120:** add pan and zoom e2e spec ([6b243a9](https://github.com/in-scope/ciag-toolbox/commit/6b243a98e92bb676ba572125265da6ef40104200))
* **CT-121:** add configurable grid layout grow/shrink e2e spec ([f847b51](https://github.com/in-scope/ciag-toolbox/commit/f847b51d7d1a4a5c68712284044eb9f79930592a))
* **CT-122:** add panel selection (single, multi, range, clear) e2e spec ([592f06a](https://github.com/in-scope/ciag-toolbox/commit/592f06a7e0a3c0140320f442de6435c225631b73))
* **CT-123:** add duplicate-to-panel e2e spec ([3c570c2](https://github.com/in-scope/ciag-toolbox/commit/3c570c288cffff2a988f5947648cb4387a9f7457))
* **CT-124:** add per-panel normalized-viewing toggle e2e spec ([21bc803](https://github.com/in-scope/ciag-toolbox/commit/21bc8036651da03397abb58e245364407f941165))
* **CT-125:** add open images unified flow e2e spec ([f40f780](https://github.com/in-scope/ciag-toolbox/commit/f40f780c7d626f2b501e087fcb9febff609e7cb4))
* **CT-126:** add load formats and metadata e2e spec ([c3f5ccd](https://github.com/in-scope/ciag-toolbox/commit/c3f5ccdaa2a167bec2dcbdcc3e2e3d3ab51c74f7))
* **CT-127:** add numeric bit-shift e2e spec ([11da8f9](https://github.com/in-scope/ciag-toolbox/commit/11da8f9bd1b4d5476ff545b057f7fa37fa7b2268))
* **CT-128:** add save/export round-trip e2e spec ([7b8a96f](https://github.com/in-scope/ciag-toolbox/commit/7b8a96f2d3582c6471b6408a20f3de364aca43b6))
* **CT-129:** add project save and resume bundle round-trip e2e spec ([fff51ed](https://github.com/in-scope/ciag-toolbox/commit/fff51ed7d5c1bd40a1e1f892af3ce112fb42db49))
* **CT-130:** add spatial crop via per-operation region e2e spec ([719a0f7](https://github.com/in-scope/ciag-toolbox/commit/719a0f7a2f28618bf3dddf6ec869b76367eddb8d))
* **CT-131:** add band keep/remove and subset e2e spec ([141c483](https://github.com/in-scope/ciag-toolbox/commit/141c48310718d791f94a97a64544febee2ca38f1))
* **CT-132:** add ROI selection and Region stats e2e spec ([a01c607](https://github.com/in-scope/ciag-toolbox/commit/a01c607cd4e9e7cff45eca40430060075efbc378))
* **CT-133:** add pixel readout and live/pinned spectra e2e spec ([358cd50](https://github.com/in-scope/ciag-toolbox/commit/358cd5030973312c2842a6509d36aaf6e9705ba4))
* **CT-134:** add metadata panel and history audit trail e2e spec ([f9394be](https://github.com/in-scope/ciag-toolbox/commit/f9394be29ac0e60a5ac780d99a6a1d965031e07a))
* **CT-135:** add shared scope popup e2e spec ([66f42b5](https://github.com/in-scope/ciag-toolbox/commit/66f42b5a237bd9f7fcb1fc4ae2283ff1bbf249a6))
* **CT-136:** add operation-produced float32 pipeline e2e spec ([58ec3b4](https://github.com/in-scope/ciag-toolbox/commit/58ec3b458e4f3e0eba4d2150294a5e614b4ee3d8))
* **CT-137:** add flat-field correction e2e spec ([e03268f](https://github.com/in-scope/ciag-toolbox/commit/e03268ff2c40fb7c84435fc56d9c13f968442a5c))
* **CT-138:** add spectralon reflectance calibration e2e spec ([f673ffd](https://github.com/in-scope/ciag-toolbox/commit/f673ffd36f852967cc2a2a1d443723f8675e0f60))
* **CT-139:** add tone-curve operation e2e spec ([5ea4925](https://github.com/in-scope/ciag-toolbox/commit/5ea492504cee98c249faa92d04d7f904b034b3e7))
* **CT-140:** add brightness and contrast operation e2e spec ([dbf0926](https://github.com/in-scope/ciag-toolbox/commit/dbf092646e4e8ace4ecbd5ef568840f498c4209d))
* **CT-141:** add invert operation e2e spec ([ed97429](https://github.com/in-scope/ciag-toolbox/commit/ed974290c754d0b707af3e4b10c4948878a62dce))
* **CT-142:** add normalize full-cube vs band-wise operation e2e spec ([e216b37](https://github.com/in-scope/ciag-toolbox/commit/e216b372fa182065101d3013002351ec529224d2))
* **CT-143:** add standardize target mean and std e2e spec ([112d740](https://github.com/in-scope/ciag-toolbox/commit/112d7402c15c35cf92d210c72a8a855b46b54129))
* **CT-144:** add rgb to grayscale operation e2e spec ([8821d4f](https://github.com/in-scope/ciag-toolbox/commit/8821d4f9eb212120e84fbd9664122d221c129843))
* **CT-145:** add false-color composite order-sensitivity e2e spec ([fb391c6](https://github.com/in-scope/ciag-toolbox/commit/fb391c64db2a3b83918bd1098cf3c691065030c3))
* **CT-146:** add rotate and reflect geometry e2e spec ([28110cb](https://github.com/in-scope/ciag-toolbox/commit/28110cbb0caa944de695f225d827ccc008f82647))
* **CT-147:** add persistent ROI spectra e2e spec ([4fdc5df](https://github.com/in-scope/ciag-toolbox/commit/4fdc5dfd326eee7f994c0cdfe7b0caa2d8950859))
* **CT-148:** add default display data-type range e2e spec ([9aad530](https://github.com/in-scope/ciag-toolbox/commit/9aad530d810f976b691970b5a0032f2f84497f25))
* **CT-149:** add spectra gap handling for removed bands e2e spec ([625cad9](https://github.com/in-scope/ciag-toolbox/commit/625cad999bd2df8dfb760789ea6a97cc2a3ef934))
* **CT-150:** add remove-individual-bands via panel x e2e spec ([9a99514](https://github.com/in-scope/ciag-toolbox/commit/9a99514f126ce2b5547b7e3e4062371b35094e65))
* **CT-151:** add decluttered right panel order and live hover spectrum e2e spec ([39ca2a9](https://github.com/in-scope/ciag-toolbox/commit/39ca2a98b311a8b1585c0e74cedf6eb67e2b2202))
* **CT-152:** add original band index/wavelength metadata and history e2e spec ([b7fcc43](https://github.com/in-scope/ciag-toolbox/commit/b7fcc4394b1018c862bdcd3c406b718c81fecba9))
* **CT-153:** add top band/file label tracks band slider e2e spec ([a0f7068](https://github.com/in-scope/ciag-toolbox/commit/a0f7068f3e58c0f6649a35970342e5275910b09a))
* **CT-154:** add roi-inspection-only shared region-request e2e spec ([329615b](https://github.com/in-scope/ciag-toolbox/commit/329615ba17e748702ac0d28206d05b524b86b3e6))
* **CT-155:** add clear-roi/no-persisting-markers e2e spec with pan-zoom check ([aaaff47](https://github.com/in-scope/ciag-toolbox/commit/aaaff47a97703a45935fbd73b886a9b951868135))
* **CT-156:** add chart axis superscript/histogram polish e2e spec ([a14e763](https://github.com/in-scope/ciag-toolbox/commit/a14e763fcc1e8f16a8d602b02507697dbbbf48f0))
* **CT-157:** add terminology sweep e2e spec for band/stack/image/panel vocabulary ([82bef2c](https://github.com/in-scope/ciag-toolbox/commit/82bef2c33503d0127f86c1324ec6f62b976890ca))
* **CT-158:** add full stage-3 chain regression e2e spec with project round-trip ([bd0adfe](https://github.com/in-scope/ciag-toolbox/commit/bd0adfe455c8d0962d6c5f6b34e9c837c213c064))
* **CT-160:** load photometric-rgb tiffs as true-colour so colour images reopen in colour ([fbd031e](https://github.com/in-scope/ciag-toolbox/commit/fbd031e9824b7bbaae33028b9c4f0071257183bc))
* **CT-161:** auto-fit float display window so 32-bit float reopens visible instead of a white frame ([00669d9](https://github.com/in-scope/ciag-toolbox/commit/00669d9b771672bb1482686f6f4523760dd220b2))
* **CT-162:** disable envi and float export for photo sources with explaining tooltips ([54da6d1](https://github.com/in-scope/ciag-toolbox/commit/54da6d1f62c2faec32c3a14b580186201786c01b))
* **CT-163:** disclose that single-band exports save only the current band of a multi-band stack ([af9e674](https://github.com/in-scope/ciag-toolbox/commit/af9e67401ba93e5f53b8833e25ce5bbebe7e6f18))
* **toolbar:** mirror operations into Edit/Image menus, group toolbar, add quick rotate/reflect buttons ([2982868](https://github.com/in-scope/ciag-toolbox/commit/2982868ca84d614da363b6697113c4c1a93001d1))
* **toolbar:** split rotate & reflect into separate operations, menus, and panels ([085c4a3](https://github.com/in-scope/ciag-toolbox/commit/085c4a3d8872a227007bbc9378aecdcbf51c0916))
* use a red trash icon for band removal to signal a destructive action ([5e99c38](https://github.com/in-scope/ciag-toolbox/commit/5e99c388743378c2271ffdb89f2401d1a2cb196f))


### Bug Fixes

* **CT-102:** map float32 to integer range on TIFF save and add 32-bit float TIFF/ENVI save options ([5d8db25](https://github.com/in-scope/ciag-toolbox/commit/5d8db25e4c4fb7cf7fa19dace1dd4fd89c76bb3b))
* **CT-103:** reuse unchanged band buffers in band-wise float ops to avoid whole-cube reallocation OOM ([9dd462c](https://github.com/in-scope/ciag-toolbox/commit/9dd462c779ad293efc65f08aa280a56a0fd6dc60))
* **CT-104:** move tone-curve editor into the Tone Curve operation panel and keep the always-on histogram plain ([323784b](https://github.com/in-scope/ciag-toolbox/commit/323784b9e09197d2d3f1f71677835a50ea250307))
* **CT-105:** auto-select the new result panel after an operation opens it ([54de76d](https://github.com/in-scope/ciag-toolbox/commit/54de76d07475f6168c1580e9470d46a11f879e3a))
* **CT-159:** present true-color images as one color image, fix per-band red tint, move toasts bottom-left ([e1ff0df](https://github.com/in-scope/ciag-toolbox/commit/e1ff0df2241c779b2cbffde338ba1d7c2f670a64))
* **CT-159:** render true-color rasters as an RGB composite so rotate/reflect keep color ([fd9b3a1](https://github.com/in-scope/ciag-toolbox/commit/fd9b3a1ee9af25ef33c33571c17d5f921e9e2eb1))
* **history:** scroll only the history list and add sleek custom scrollbars ([75e2613](https://github.com/in-scope/ciag-toolbox/commit/75e261315cf6c99c787f16bca10426c87a92d832))


### Documentation

* **e2e:** correct stale comments claiming PNG/JPG cannot be transformed ([6994f15](https://github.com/in-scope/ciag-toolbox/commit/6994f157e77968bd69f627be5e8972731bc5af6d))
* **e2e:** document trace inspection and test-results clean script ([bf0ea2e](https://github.com/in-scope/ciag-toolbox/commit/bf0ea2e7a435c092385ddd567d7c9104e4a266aa))

## [0.2.1](https://github.com/in-scope/ciag-toolbox/compare/v0.2.0...v0.2.1) (2026-06-08)


### Features

* **CT-063:** rename normalize to normalized viewing as a view-only per-cell toggle ([1cf58fc](https://github.com/in-scope/ciag-toolbox/commit/1cf58fc261c6513a2a72c62ca2b146ecdeef833b))
* **CT-064:** add min/max/zero x-axis tick labels to right-panel histogram ([c510c32](https://github.com/in-scope/ciag-toolbox/commit/c510c3217728a09ded8bd765b5a66fa3b1659713))
* **CT-067:** preserve original band indices/labels after Keep Bands ([289385a](https://github.com/in-scope/ciag-toolbox/commit/289385a57b3735f639d8e5cd4c5e9748c8dc4c58))
* **CT-068:** reword bit shift parameter help text into plain language ([9a62ec7](https://github.com/in-scope/ciag-toolbox/commit/9a62ec7e482af286667349eacabd81ed2ab520ed))
* **CT-069:** add on-viewport band slider with numeric input for multi-band sources ([2694e7a](https://github.com/in-scope/ciag-toolbox/commit/2694e7a0bceb814d33bda5fb65f29c2b98aa2971))
* **CT-070:** add documented configurable 16 GiB openable file size guard ([8d3943e](https://github.com/in-scope/ciag-toolbox/commit/8d3943ea7e5a2531fd0dd808fb86b266d0b1dff3))
* **CT-073:** debounce band-slider loading and add previous/next step buttons ([30ee70c](https://github.com/in-scope/ciag-toolbox/commit/30ee70ca5aba4640442673a103d33be3a9db3775))
* **CT-074:** show preserved original band index in bands list, pixel inspector, status bar, and histogram ([28c9e11](https://github.com/in-scope/ciag-toolbox/commit/28c9e11c8a753ff592d05948c1fd5fc456749715))
* **CT-075:** widen replace-target picker names and add a hover tooltip for the full name ([d1efb70](https://github.com/in-scope/ciag-toolbox/commit/d1efb70fc4fd1883922ce38ce912547e001f98da))


### Bug Fixes

* **CT-059:** grow grid and fill empty cells before prompting to replace when opening many images ([92e8073](https://github.com/in-scope/ciag-toolbox/commit/92e807375f96d178f09eb634ff61b44e52c5e486))
* **CT-060:** key roi corner handles by stable position so dragging does not leave stray points ([108b0b0](https://github.com/in-scope/ciag-toolbox/commit/108b0b0de836399d4e8443c32b4914a098008ed5))
* **CT-061:** stream unmodified on-disk sources into project bundles instead of re-encoding large rasters through ipc ([bdc741a](https://github.com/in-scope/ciag-toolbox/commit/bdc741a226f7444a024f3012e577e96bea2b301f))
* **CT-062:** map data-type range to black-to-white by default, fix signed-int and float display scaling ([ff341c6](https://github.com/in-scope/ciag-toolbox/commit/ff341c65344ea6b493ad4945fc0e0b60ffcc6c0c))
* **CT-065:** tile histogram bars on integer pixel edges to remove missing-stripe artifact ([c1ae520](https://github.com/in-scope/ciag-toolbox/commit/c1ae520e493dcdd439fc197dea753f005121c83e))
* **CT-066:** space spectra x-axis ticks evenly across value range to prevent overlap after band subsetting ([ab483ff](https://github.com/in-scope/ciag-toolbox/commit/ab483ffdf04e30d0804bda56a23c344010636167))
* **CT-072:** paint save progress indicator before the heavy raster bake blocks the renderer ([7ed8846](https://github.com/in-scope/ciag-toolbox/commit/7ed88467b6f631085a586d3b29b3e9a02c1fc104))


### Miscellaneous

* release 0.2.1 ([3c313a4](https://github.com/in-scope/ciag-toolbox/commit/3c313a4d2e979dca04c3a26ccc56481ceea34a30))

## [0.2.0](https://github.com/in-scope/ciag-toolbox/compare/v0.1.2...v0.2.0) (2026-05-14)

This is the first major content release after the initial scaffold. It introduces
the full image-loading, viewport-rendering, and operations stack that lets MSI Toolbox
load real multispectral data, inspect it, transform it, and save the result as a project.

Almost all of this work landed via [#3](https://github.com/in-scope/ciag-toolbox/issues/3).

### Image loading and formats

* **CT-023:** single-band TIFF loader and raster image source
* **CT-026:** multi-page TIFF support and per-viewport band selection
* **CT-027:** ENVI `.hdr` + binary loader with interleave-aware reader
* **CT-028:** raw camera loader via lazy-loaded `libraw-wasm`
* **CT-054:** open multiple single-band TIFFs together as a multi-band image
* **CT-055:** unified Open Images flow (no more separate open-image vs. open-stack paths)
* **fix(load-tiff):** skip embedded thumbnail pages instead of rejecting multi-page TIFFs

### Rendering and viewport

* **CT-024:** tile-based R16F renderer for large rasters
* **CT-025:** single-band grayscale broadcast in the shader
* **feat(zoom):** allow zoom past pixel level and 25% beyond fit, sharpen mag filter

### Image processing operations

* **CT-029:** parametric operation framework for viewport actions
* **CT-030:** bit-shift operation with raster transform hook
* **CT-040:** spatial crop using ROI
* **CT-041:** band keep/remove for multi-band images
* **feat(bit-shift):** apply-to-region scope option

### Region of interest and analysis

* **CT-037:** pixel value readout in the status bar
* **CT-038:** spectra plot for multi-band images
* **CT-039:** rectangular ROI selection on a viewport
* **CT-057:** pixel inspector panel with per-band rows and slim status bar
* **CT-058:** active-band histogram panel with worker computation and section reorder

### Multi-band image support

* **CT-056:** active-band radio model for the Bands panel and Keep Bands modal
* **refactor(subset-bands):** replace Keep Bands modal with an inline right-panel section and toolbar toggle

### Grid layout and viewport management

* **CT-042:** add 1x3 and 3x1 grid layouts
* **CT-043:** collapse grid layout when closing a loaded viewport
* **CT-044:** auto-grow grid layout when opening an image
* **CT-045:** hide close and duplicate context-menu items on empty viewports
* **fix(grid):** preserve loaded images when collapsing layout on viewport close
* **fix(history):** inherit source viewport rendering state when duplicating

### Metadata and history

* **CT-035:** operation history audit trail with right-panel display
* **CT-036:** right-panel image metadata section with empty state

### Project save and export

* **CT-031:** image export with TIFF/PNG/JPEG format chooser
* **CT-032:** ENVI format write with paired `.hdr` / binary sidecar
* **CT-033:** project state save and load via `.ctproj`
* **CT-034:** pack project as `.ctbundle` archive with streaming zip
* **CT-053:** bundle-only project save with baked assets

### Performance

* **CT-051:** busy-state context and loading indicators for long-running flows
* **perf(stack-open):** stream files one at a time to avoid renderer OOM

### Theming

* **CT-046:** default theme to dark on first launch
* **CT-047:** strengthen panel borders in light theme

### Bug fixes

* **fix(CT-048):** clear stale ROI overlay after crop and tool toggle
* **fix(open-images-review):** smart file size display, single-row mode menu, image title, multi-band drag lock

### App identity

* MSI Toolbox app icon and startup splash screen

### Continuous Integration

* Initial release-please workflow ([#3](https://github.com/in-scope/ciag-toolbox/issues/3))
* Wire release-please into the build workflow so installers upload to the release ([#5](https://github.com/in-scope/ciag-toolbox/pull/5))
