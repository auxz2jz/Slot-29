# Open Camera Map — Slot-29

A mobile-first personal map of **officially published, public camera feeds**. Starts in the Dos Palos / Merced / Madera area and is designed to expand.

## Features
- Interactive OpenStreetMap/Leaflet map, marker clusters, search, source colors, and camera list
- **All camera sources + all 12 Caltrans districts** selected by default, including after browser form restoration. All district directories load regardless of the selected display filter, with up to three concurrent requests; district changes are instant local filters rather than additional downloads. **All cameras** button clears source/district/map-only filters. **Search always searches statewide**, even if an individual district is selected.
- Corrected Caltrans camera JSON filenames to the official zero-padded D01–D09 scheme; includes fallback to official Caltrans GIS data where needed.
- **Madera** and **Dos Palos** map shortcuts, plus GPS marker, map-position search and nearby-sorted results.
- For performance, only camera pins inside/near the current visible map view are rendered; lists can still search all loaded California cameras.
- Uses Caltrans' published direct HLS `.m3u8` URLs and JPEG snapshots, *not* the QuickMap interface
- ALERTCalifornia camera layer (UC San Diego; public wildfire cameras)
- Cal OES public webcams catalog for additional public sources; these may be external webpage links rather than embeddable video
- Add a manually verified, **public and authorized** camera on the map, stored only in your browser
- One-camera-at-a-time playback to conserve phone data; locally saved favorites
- **Full-screen camera viewing in the same website:** Tap **⛶ Full screen** in the camera viewer to expand its currently playing HLS video or image. Tap **✕ Exit full screen** or the browser Back/Escape control to return to the player and map. No redirect to Caltrans or an outside provider is required. Uses the browser Fullscreen API where available, with an in-page overlay fallback (including browsers that disallow fullscreen for non-video elements).
- **Opt-in persistent GPS while the page is active**: Start GPS shows a blue marker and GPS accuracy circle, follows movement and stores *only* the preference that GPS is enabled. The site attempts to resume on reload if geolocation permission is still granted. A watchdog polls/restarts a stalled watch and requests a fresh GPS reading after returning to the foreground. Drag map to stop following; **Follow me** resumes centering. **Stop GPS** disables stored preference and removes your marker.
- Display source and stream type so a camera is not mistaken for Caltrans

## Try it
In GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → main / root**, then open:
https://auxz2jz.github.io/Slot-29/

Or use a static HTTP server locally, e.g. `python -m http.server 8000`, and visit http://localhost:8000/.

## Sources / attribution
- Caltrans CCTV: https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm
- Caltrans ArcGIS public backup: https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/CCTV/FeatureServer/0
- ALERTCalifornia / UC San Diego: https://alertcalifornia.org/ and its official Esri layer
- Cal OES public webcam location layer: https://services.arcgis.com/BLN4oKB0N1YSgvY8/ArcGIS/rest/services/CalOES_California_Webcams/FeatureServer/0
- OpenStreetMap contributors for map imagery; Leaflet and hls.js for browser UI/player

Public listings are **not** physical camera IP addresses. A camera can be in the directory but have no playable stream. Providers may change streams, restrict browser playback (CORS), or take devices offline. The app doesn't bypass authorization, authentication or access restrictions, doesn't save video, and never scans camera networks. If an external provider prevents embedding, use **Open provider page** or **Open feed**.

**GPS privacy and requirements:** Location permission is requested after tapping **Start GPS**; a later reload may resume without prompting if the browser permission is still granted. GPS uses the browser's `watchPosition()` and periodic foreground checks while this page is active (**not guaranteed to operate while the screen is off or the browser is backgrounded**). Coordinates are not saved in GitHub or browser storage and are not sent to camera endpoints; only the on/off preference is stored; however, as with any slippy map, tile servers can infer the viewed geographic area from the map tiles requested. Press **Stop GPS** to clear the location marker and stop updates. GPS requires HTTPS or localhost, location permission, and OS/browser location services. Accuracy is a browser estimate, not a navigation guarantee.

No API keys, backend, or user accounts are required for the initial public sources. The browser connects to the agencies' endpoints, so connectivity/agency policies affect reliability. Never store sensitive personal or company camera URLs in a public repo. Custom entries/favorites stay in this device's localStorage.

## Status
Prototype v0.5 — browser/device testing and external stream verification still needed. In a static Github Pages site, some HLS feeds may fail because of CORS. A later opt-in server proxy can address genuine compatibility issues where permitted, without attempting to access private cameras.

## Camera data troubleshooting

The primary source uses https://cwwp2.dot.ca.gov/data/d6/cctv/cctvStatusD06.json for Madera (District 6), not `cctvStatusD6.json`. A browser's network/CORS problems can still affect a subset of districts; the app attempts the agency GIS backup and reports unavailable districts in the camera list. The **All California** selection loads public feed directories, not restricted camera IP addresses. If some listings are offline or not public, these cameras may have no working playable video even when their map marker is present.
