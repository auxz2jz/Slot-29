# Open Camera Map — Slot-29

A mobile-first personal map of **officially published, public camera feeds**. Starts in the Dos Palos / Merced / Madera area and is designed to expand.

## Features
- Interactive OpenStreetMap/Leaflet map, marker clusters, search, source colors, and camera list
- Caltrans District 10 by default; select any of Caltrans Districts 1–12
- Uses Caltrans' published direct HLS `.m3u8` URLs and JPEG snapshots, *not* the QuickMap interface
- ALERTCalifornia camera layer (UC San Diego; public wildfire cameras)
- Cal OES public webcams catalog for additional public sources; these may be external webpage links rather than embeddable video
- Add a manually verified, **public and authorized** camera on the map, stored only in your browser
- One-camera-at-a-time playback to conserve phone data; locally saved favorites
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

No API keys, backend, or user accounts are required for the initial public sources. The browser connects to the agencies' endpoints, so connectivity/agency policies affect reliability. Never store sensitive personal or company camera URLs in a public repo. Custom entries/favorites stay in this device's localStorage.

## Status
Prototype v0.1 — browser/device testing and external stream verification still needed. In a static Github Pages site, some HLS feeds may fail because of CORS. A later opt-in server proxy can address genuine compatibility issues where permitted, without attempting to access private cameras.
