/* Open Camera Map v0.4 - public/authorized sources only. No hidden camera discovery. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const LOCAL = [36.959, -120.057];
  const DOS_PALOS = [37.055, -120.63];
  const ALL_DISTRICTS = [6,10,3,4,5,7,8,2,1,9,11,12];
  const districtCache = new Map();
  let caltransProgress = "";
  const DISTRICT_CENTERS = {
    1:[40.75,-123.1],2:[40.55,-122.3],3:[39.0,-121.2],4:[37.75,-122.25],
    5:[35.4,-120.3],6:[36.7,-119.65],7:[34.05,-118.25],8:[34.3,-117.35],
    9:[37.2,-118.45],10:[37.05,-120.63],11:[32.85,-116.55],12:[33.75,-117.85]
  };
  const SOURCE_INFO = {
    caltrans:{label:"Caltrans", icon:"C"},
    alertca:{label:"ALERTCalifornia", icon:"F"},
    caloes:{label:"Other · Cal OES", icon:"O"},
    custom:{label:"My camera", icon:"+"}
  };
  const GIS_CALTRANS = "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/CCTV/MapServer/0/query";
  const GIS_ALERT = "https://services8.arcgis.com/X84q166Srnyl4JMV/ArcGIS/rest/services/ALERTCalifornia_Camera_Feed/FeatureServer/0/query";
  const GIS_CALOES = "https://services.arcgis.com/BLN4oKB0N1YSgvY8/ArcGIS/rest/services/CalOES_California_Webcams/FeatureServer/0/query";
  const sources = {caltrans:[],alertca:[],caloes:[],custom:[]};
  const sourceErrors = {caltrans:"",alertca:"",caloes:""};
  const STORAGE_CUSTOM = "openCameraMapCustom_v1";
  const STORAGE_FAV = "openCameraMapFav_v1";
  let favorites = new Set(safeRead(STORAGE_FAV, []));
  let selected = null, currentHls = null, currentTimer = null;
  let loadSeq = 0, othersSeq = 0, delayedOthers = 0, toastTimer = 0;
  let onlyWithinMap = false, placingPin = false;
  let cluster;
  let gpsWatchId = null, gpsMarker = null, gpsAccuracyCircle = null;
  let gpsFollow = true, gpsFirstFix = true, gpsLastFix = null;

  function safeRead(key, fallback) {
    try { const parsed = JSON.parse(localStorage.getItem(key)); return Array.isArray(parsed) ? parsed : fallback; }
    catch (_) { return fallback; }
  }
  function safeWrite(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { toast("Local storage blocked: changes may not persist"); return false; }
  }
  function validUrl(raw) {
    if (typeof raw !== "string" || !raw.trim() || raw.trim() === "Not Reported") return "";
    try { const url = new URL(raw.trim()); return (url.protocol === "https:" || url.protocol === "http:") ? url.href : ""; }
    catch (_) { return ""; }
  }
  function validPosition(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  }
  function mediaKind(url) {
    const cleaned = validUrl(url);
    if (!cleaned) return "link";
    const path = (new URL(cleaned)).pathname.toLowerCase();
    if (path.endsWith(".m3u8")) return "hls";
    if (/\.(jpg|jpeg|png|webp|gif)$/.test(path)) return "image";
    if (/mjpeg|mjpg/.test(path)) return "mjpeg";
    if (path.endsWith(".mp4")) return "mp4";
    return "link";
  }
  function normalized(cam) {
    cam.lat = Number(cam.lat); cam.lng = Number(cam.lng);
    if (!validPosition(cam.lat, cam.lng)) return null;
    cam.stream = validUrl(cam.stream);
    cam.snapshot = validUrl(cam.snapshot);
    cam.page = validUrl(cam.page);
    cam.name = String(cam.name || "Unnamed camera");
    cam.operator = String(cam.operator || SOURCE_INFO[cam.source].label);
    cam.location = String(cam.location || "");
    cam.route = String(cam.route || "");
    cam.status = String(cam.status || "Unknown");
    cam.kind = mediaKind(cam.stream);
    return cam;
  }
  function toast(message) {
    const el = $("toast"); el.textContent = message; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3800);
  }
  async function fetchJson(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms || 14000);
    try {
      const r = await fetch(url, {signal:controller.signal, cache:"no-store", mode:"cors"});
      if (!r.ok) throw new Error("HTTP " + r.status);
      const result = await r.json();
      if (result.error) throw new Error(result.error.message || "Agency query error");
      return result;
    } finally { clearTimeout(timer); }
  }
  function parameters(base, params) {
    const url = new URL(base);
    Object.keys(params).forEach((key) => url.searchParams.set(key, String(params[key])));
    return url.href;
  }
  function normalizeDistrictJson(row, district) {
    const x = row && row.cctv;
    if (!x || !x.location) return null;
    const l = x.location, im = x.imageData || {}, st = im.static || {};
    return normalized({
      id:"caltrans:" + district + ":" + x.index,
      source:"caltrans", name:l.locationName, operator:"Caltrans District " + district,
      lat:l.latitude, lng:l.longitude, location:[l.nearbyPlace,l.county ? l.county + " County" : ""].filter(Boolean).join(" · "),
      route:l.route, stream:im.streamingVideoURL, snapshot:st.currentImageURL,
      refresh:Number(st.currentImageUpdateFrequency) || 2,
      status:String(x.inService).toLowerCase() === "true" ? "Listed in service" : "Listed offline",
      page:"https://quickmap.dot.ca.gov/"
    });
  }
  function normalizeDistrictArc(row, district) {
    const a = row.attributes || {};
    return normalized({
      id:"caltrans:" + district + ":" + (a.index_ || a.OBJECTID),
      source:"caltrans", name:a.locationName, operator:"Caltrans District " + district,
      lat:a.latitude || (row.geometry && row.geometry.y),
      lng:a.longitude || (row.geometry && row.geometry.x),
      location:[a.nearbyPlace,a.county ? a.county + " County" : ""].filter(Boolean).join(" · "),
      route:a.route, stream:a.streamingVideoURL, snapshot:a.currentImageURL,
      refresh:Number(a.currentImageUpdateFrequency) || 2,
      status:String(a.inService).toLowerCase() === "true" ? "Listed in service" : "Listed offline",
      page:"https://quickmap.dot.ca.gov/"
    });
  }
  // Official filenames use D01 ... D09 for districts 1–9, not D1 ... D9.
  // Madera County is District 6 and Merced County is District 10.
  async function fetchCaltransDistrict(district, bypassCache) {
    if (!bypassCache && districtCache.has(district)) {
      return {cams:districtCache.get(district),warning:""};
    }
    let cams = [];
    let warning = "";
    try {
      const padded = String(district).padStart(2,"0");
      const endpoint = "https://cwwp2.dot.ca.gov/data/d" + district + "/cctv/cctvStatusD" + padded + ".json";
      const data = await fetchJson(endpoint,18000);
      if (!Array.isArray(data.data)) throw new Error("Unexpected Caltrans JSON structure");
      cams = data.data.map((row) => normalizeDistrictJson(row,district)).filter(Boolean);
      if (!cams.length) throw new Error("No valid camera positions reported");
    } catch (primaryError) {
      // Official statewide GIS fallback for browser/network issues affecting a district's JSON file.
      try {
        const endpoint = parameters(GIS_CALTRANS, {
          where:"district = " + district, outFields:"*", returnGeometry:"false",
          resultRecordCount:2000, f:"json"
        });
        const data = await fetchJson(endpoint,18000);
        cams = (data.features || []).map((row) => normalizeDistrictArc(row,district)).filter(Boolean);
        if (!cams.length) throw new Error("GIS backup returned no cameras");
        warning = "D" + district + " using GIS backup";
      } catch (secondaryError) {
        throw new Error("D" + district + ": primary " + primaryError.message + "; backup " + secondaryError.message);
      }
    }
    districtCache.set(district,cams);
    return {cams,warning};
  }
  async function loadCaltrans(options) {
    const seq = ++loadSeq;
    const selection = $("district").value;
    const districts = selection === "all" ? ALL_DISTRICTS : [Number(selection)];
    const bypassCache = Boolean(options && options.refresh);
    const all = [];
    const warnings = [], failures = [];
    let completed = 0;
    sources.caltrans = [];
    sourceErrors.caltrans = "";
    caltransProgress = "Loading Caltrans · 0/" + districts.length + " districts";
    render();
    // Load the closest counties first, with at most three simultaneous public requests.
    const concurrency = Math.min(3,districts.length);
    let pointer = 0;
    async function worker() {
      while (pointer < districts.length && seq === loadSeq) {
        const district = districts[pointer++];
        try {
          const result = await fetchCaltransDistrict(district,bypassCache);
          if (seq !== loadSeq) return;
          all.push(...result.cams);
          if (result.warning) warnings.push(result.warning);
        } catch (error) {
          if (seq !== loadSeq) return;
          failures.push(error.message);
        }
        if (seq !== loadSeq) return;
        completed++;
        // Incremental results put Madera and Merced cameras on the map immediately.
        sources.caltrans = all.slice();
        caltransProgress = completed < districts.length
          ? "Loading Caltrans · " + completed + "/" + districts.length + " districts"
          : "";
        sourceErrors.caltrans = failures.length ? "Unavailable: " + failures.map((x) => x.split(":")[0]).join(", ") : "";
        render();
      }
    }
    await Promise.all(Array.from({length:concurrency},() => worker()));
    if (seq !== loadSeq) return;
    caltransProgress = "";
    sourceErrors.caltrans = failures.length
      ? "Could not load " + failures.length + " district(s): " + failures.map((x) => x.split(":")[0]).join(", ")
      : warnings.length ? "Some districts are using Caltrans GIS backup: " + warnings.join(", ") : "";
    render();
  }

  function currentEnvelope() {
    const b = map.getBounds().pad(.22);
    return {xmin:b.getWest(),ymin:b.getSouth(),xmax:b.getEast(),ymax:b.getNorth(),spatialReference:{wkid:4326}};
  }
  async function queryWithin(endpoint, fields, pageSize, maxPages, envelope) {
    const all = [];
    for (let page = 0; page < maxPages; page++) {
      const url = parameters(endpoint, {
        where:"1=1", outFields:fields, returnGeometry:"true", outSR:4326,
        geometry:JSON.stringify(envelope), geometryType:"esriGeometryEnvelope",
        spatialRel:"esriSpatialRelIntersects", inSR:4326,
        resultOffset:all.length, resultRecordCount:pageSize, f:"json"
      });
      const data = await fetchJson(url);
      const chunk = data.features || [];
      all.push(...chunk);
      if (chunk.length < pageSize || (!data.exceededTransferLimit && chunk.length === 0)) break;
    }
    return all;
  }
  function normalizeAlert(row) {
    const a = row.attributes || {}, g = row.geometry || {};
    const page = validUrl(a.cameraURL) || validUrl(a.networkURL) || "https://cameras.alertcalifornia.org/";
    const image = validUrl(a.imageURL);
    return normalized({
      id:"alertca:" + (a.siteId || a.OBJECTID),
      source:"alertca", name:a.cameraName || a.siteId, operator:"ALERTCalifornia / UC San Diego",
      lat:g.y, lng:g.x, location:a.county ? a.county + " County" : "",
      route:"Wildfire / scenic", stream:mediaKind(image) !== "link" ? image : "",
      snapshot:mediaKind(image) === "image" ? image : "",
      status:a.isOnline || "Unknown", page:page, refresh:30
    });
  }
  function normalizeCalOes(row) {
    const a = row.attributes || {}, g = row.geometry || {};
    const sourceName = String(a.Source || "");
    const url = validUrl(a.Webcam_URL) || validUrl(a.Consolidated_URL);
    const operatorPage = validUrl(a.Source_URL) || validUrl(a.PopUp_URL) || url;
    const ident = (sourceName + " " + (url || "") + " " + (operatorPage || "")).toLowerCase();
    // The Cal OES directory also includes Caltrans and ALERTCalifornia records.
    // Avoid showing duplicates under the misleading "Other" marker.
    if (/caltrans|cwwp2\.dot\.ca\.gov|wzmedia\.dot\.ca\.gov|alertcalifornia|alertwildfire|alertca\.live/.test(ident)) return null;
    const kind = mediaKind(url);
    return normalized({
      id:"caloes:" + a.OBJECTID, source:"caloes",
      name:a.Location || a.NearBy_Place || "Public webcam",
      operator:sourceName || "Listed by Cal OES",
      lat:a.Latitude || g.y, lng:a.Longitude || g.x,
      location:[a.NearBy_Place,a.County].filter(Boolean).join(" · "),
      route:a.CameraType || "Other", stream:kind !== "link" ? url : "",
      snapshot:mediaKind(a.Thumbnail_Url) === "image" ? a.Thumbnail_Url : (kind === "image" ? url : ""),
      status:"Public directory listing; availability unverified",
      page:operatorPage || url || "https://www.caloes.ca.gov/", refresh:60
    });
  }
  async function loadOtherSources() {
    const seq = ++othersSeq;
    const box = currentEnvelope();
    const tasks = [
      queryWithin(GIS_ALERT,"OBJECTID,cameraName,siteId,county,isOnline,cameraURL,networkURL,imageURL",50,5,box)
        .then((rows) => ({source:"alertca",cams:rows.map(normalizeAlert).filter(Boolean)})),
      queryWithin(GIS_CALOES,"OBJECTID,Location,Source,Source_URL,Webcam_URL,Consolidated_URL,PopUp_URL,NearBy_Place,County,CameraType,Latitude,Longitude,Thumbnail_Url",100,3,box)
        .then((rows) => ({source:"caloes",cams:rows.map(normalizeCalOes).filter(Boolean)}))
    ];
    const results = await Promise.allSettled(tasks);
    if (seq !== othersSeq) return;
    results.forEach((result,index) => {
      const key = index ? "caloes" : "alertca";
      if (result.status === "fulfilled") {
        sources[key] = result.value.cams; sourceErrors[key] = "";
      } else {
        sourceErrors[key] = SOURCE_INFO[key].label + " unavailable: " + (result.reason && result.reason.message || "network error");
      }
    });
    render();
  }
  function scheduleOtherSources() {
    clearTimeout(delayedOthers);
    delayedOthers = setTimeout(loadOtherSources, 650);
  }
  function loadCustom() {
    sources.custom = safeRead(STORAGE_CUSTOM, []).map((c) => {
      if (!c || !c.id) return null;
      return normalized(Object.assign({},c,{source:"custom"}));
    }).filter(Boolean);
  }
  function allCameras() {
    return [].concat(sources.caltrans,sources.alertca,sources.caloes,sources.custom);
  }
  function sourceMatches(camera) {
    const filter = $("sourceFilter").value;
    return filter === "all" || (filter === "favorites" ? favorites.has(camera.id) : camera.source === filter);
  }
  function textMatches(camera) {
    const input = $("search").value.trim().toLowerCase();
    if (!input) return true;
    return [camera.name,camera.location,camera.operator,camera.route,SOURCE_INFO[camera.source].label]
      .some((s) => String(s || "").toLowerCase().includes(input));
  }
  function filtered() {
    const bounds = map.getBounds();
    return allCameras().filter((c) => sourceMatches(c) && textMatches(c) && (!onlyWithinMap || bounds.contains([c.lat,c.lng])));
  }
  function distanceFromCenter(cam) {
    const p = map.getCenter(), dy = cam.lat - p.lat, dx = (cam.lng - p.lng) * Math.cos(p.lat * Math.PI / 180);
    return dy*dy + dx*dx;
  }
  function asLabel(source) { return SOURCE_INFO[source] ? SOURCE_INFO[source].label : "Other"; }
  function tag(source) {
    const el = document.createElement("span"); el.className = "tag " + source; el.textContent = asLabel(source); return el;
  }
  function el(name, className, textValue) {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (textValue !== undefined) node.textContent = String(textValue);
    return node;
  }
  function hasPlayable(cam) { return ["hls","mjpeg","mp4","image"].includes(cam.kind) || !!cam.snapshot; }
  function makeCard(cam) {
    const b = el("button","cam-card"); b.type = "button";
    b.appendChild(tag(cam.source));
    b.appendChild(el("div","cam-name",(favorites.has(cam.id) ? "★ " : "") + cam.name));
    b.appendChild(el("div","cam-sub",cam.location || cam.operator));
    b.appendChild(el("div","cam-foot",(cam.route ? cam.route + " · " : "") + (cam.kind === "hls" ? "LIVE VIDEO" : hasPlayable(cam) ? "IMAGE / VIDEO" : "PROVIDER LINK")));
    b.addEventListener("click",() => {
      map.setView([cam.lat,cam.lng],Math.max(map.getZoom(),12),{animate:true});
      openCamera(cam);
    });
    return b;
  }
  function updateStatus(message) {
    const count = allCameras().length;
    const filteredCount = filtered().length;
    $("resultCount").textContent = count ? filteredCount + " of " + count + " cameras" : "Looking for cameras…";
    const failures = Object.values(sourceErrors).filter(Boolean);
    $("status").textContent = [message || caltransProgress, failures.length ? failures.join(" · ") : ""].filter(Boolean).join(" · ") || "Blue: Caltrans · Orange: wildfire · Teal: other";
  }
  function render() {
    if (!cluster) return;
    const shown = filtered();
    cluster.clearLayers();
    const frag = document.createDocumentFragment();
    // Markers for all matching entries, not just the list's 100 entries.
    const visibleBounds = map.getBounds().pad(0.35);
    shown.forEach((cam) => {
      if (!visibleBounds.contains([cam.lat,cam.lng])) return;
      const icon = L.divIcon({
        html:'<span class="camera-marker ' + cam.source + '">' + SOURCE_INFO[cam.source].icon + "</span>",
        className:"", iconSize:[24,24], iconAnchor:[12,12]
      });
      const marker = L.marker([cam.lat,cam.lng],{icon,title:cam.name});
      marker.on("click",() => openCamera(cam));
      cluster.addLayer(marker);
    });
    const sorted = shown.slice().sort((a,b) => distanceFromCenter(a) - distanceFromCenter(b));
    sorted.slice(0,100).forEach((cam) => frag.appendChild(makeCard(cam)));
    const list = $("camList");
    list.replaceChildren(frag);
    if (!sorted.length) {
      const e = el("div","empty");
      e.append(el("strong","",allCameras().length ? "No matching cameras" : "No camera data yet"));
      e.append(el("span","",allCameras().length ? "Change your search, map position or source filter." : "Trying public camera directories; use Refresh to retry."));
      list.replaceChildren(e);
    } else if (sorted.length > 100) {
      list.appendChild(el("p","empty","Showing 100 nearest matches in list. All matching pins remain on the map."));
    }
    updateStatus();
  }
  function destroyMedia() {
    if (currentTimer) clearInterval(currentTimer);
    currentTimer = null;
    if (currentHls) { currentHls.destroy(); currentHls = null; }
    const vid = $("mediaBox").querySelector("video");
    if (vid) { vid.pause(); vid.removeAttribute("src"); vid.load(); }
    $("mediaBox").replaceChildren();
  }
  function setMediaStatus(message) { $("mediaStatus").textContent = message; }
  function snapshotURL(url) {
    // Caltrans snapshots are static paths; add cache-buster for subsequent updates.
    const u = new URL(url);
    if (/\.dot\.ca\.gov$/i.test(u.hostname) && !u.search) u.searchParams.set("t", String(Date.now()));
    return u.href;
  }
  function showSnapshot() {
    if (!selected) return;
    destroyMedia();
    const url = selected.snapshot || (["image","mjpeg"].includes(selected.kind) ? selected.stream : "");
    if (!url) {
      $("mediaBox").append(el("p","","No public still image published for this camera. Use the provider link below."));
      setMediaStatus("Image unavailable · operator page may offer live video.");
      return;
    }
    const image = el("img"); image.alt = selected.name + " camera still image";
    image.referrerPolicy = "no-referrer";
    image.onerror = () => setMediaStatus("Still image failed to load. Try Open direct feed.");
    image.onload = () => setMediaStatus("Still image · updates depend on the camera operator");
    image.src = snapshotURL(url);
    $("mediaBox").append(image);
    const seconds = Math.max(30,Math.min(300,Number(selected.refresh)*60 || 120));
    currentTimer = setInterval(() => { if ($("viewer").open && selected) image.src = snapshotURL(url); },seconds * 1000);
  }
  function playLive() {
    if (!selected) return;
    destroyMedia();
    const url = selected.stream;
    if (selected.kind === "image" || selected.kind === "mjpeg") { showSnapshot(); return; }
    if (selected.kind !== "hls" && selected.kind !== "mp4") {
      $("mediaBox").append(el("p","","This listing provides a provider webpage, not a directly playable public stream."));
      setMediaStatus("Click Open provider page to view the camera.");
      return;
    }
    const video = el("video");
    video.controls = true; video.autoplay = true; video.muted = true;
    video.playsInline = true; video.preload = "none";
    video.setAttribute("aria-label",selected.name + " public video feed");
    video.addEventListener("error",() => setMediaStatus("Stream unavailable or browser access blocked; try Open direct feed."));
    $("mediaBox").append(video);
    if (selected.kind === "mp4" || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.play().catch(() => setMediaStatus("Press play on the video to start this stream."));
    } else if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({enableWorker:true, lowLatencyMode:true});
      currentHls = hls;
      hls.loadSource(url); hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED,() => video.play().catch(() => setMediaStatus("Tap play in the video player.")));
      hls.on(Hls.Events.ERROR,(_,detail) => {
        if (detail.fatal) {
          setMediaStatus("Stream could not be played (" + detail.type + "). Try Open direct feed.");
          hls.destroy(); if (currentHls === hls) currentHls = null;
        }
      });
    } else {
      setMediaStatus("This browser cannot play HLS; open the direct stream in a compatible player.");
      video.remove();
      $("mediaBox").append(el("p","","HLS playback is unsupported in this browser."));
      return;
    }
    setMediaStatus("Connecting to live public feed… no recording.");
  }
  function setExternalLink(id,url) {
    const a = $(id), safe = validUrl(url);
    a.hidden = !safe; if (safe) a.href = safe; else a.removeAttribute("href");
  }
  function openCamera(cam) {
    exitLocalFullscreen();
    selected = cam; destroyMedia();
    $("viewTag").replaceWith(tag(cam.source));
    // The replaced badge must retain its stable ID for future selections.
    const badge = $("viewer").querySelector(".viewer-bar .tag"); badge.id = "viewTag";
    $("viewTitle").textContent = cam.name;
    $("viewMeta").textContent = [cam.operator,cam.location,cam.status].filter(Boolean).join(" · ");
    $("favBtn").textContent = favorites.has(cam.id) ? "★ Favorited" : "☆ Favorite";
    $("playBtn").disabled = !["hls","mjpeg","mp4"].includes(cam.kind);
    $("snapshotBtn").disabled = !(cam.snapshot || cam.kind === "image");
    $("removeCustom").hidden = cam.source !== "custom";
    setExternalLink("directLink",cam.stream || cam.snapshot);
    setExternalLink("operatorLink",cam.page);
    setMediaStatus("");
    if (cam.snapshot || cam.kind === "image") showSnapshot();
    else {
      $("mediaBox").append(el("p","",cam.kind === "hls" ? "Live stream available. Tap Play live to connect." : "No direct image; use the provider page, or start a supported live stream."));
    }
    if (!$("viewer").open) $("viewer").showModal();
  }
  function isLocalFullscreen() {
    const stage = $("mediaStage");
    return document.fullscreenElement === stage || stage.classList.contains("fullscreen-fallback");
  }
  function syncFullscreenControls() {
    const active = isLocalFullscreen();
    $("fullscreenBtn").setAttribute("aria-pressed", String(active));
    $("fullscreenBtn").textContent = active ? "⛶ Exit full screen" : "⛶ Full screen";
    $("exitFullscreenBtn").hidden = !active;
  }
  function exitLocalFullscreen() {
    // Exit only the full-screen state owned by our camera, not another element.
    $("mediaStage").classList.remove("fullscreen-fallback");
    if (document.fullscreenElement === $("mediaStage") && document.exitFullscreen) {
      const pending = document.exitFullscreen();
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    }
    syncFullscreenControls();
  }
  async function toggleLocalFullscreen() {
    const stage = $("mediaStage");
    if (isLocalFullscreen()) { exitLocalFullscreen(); return; }
    // Media is already playing; expanding the stage leaves the video source untouched.
    // Safari on iOS may not fullscreen an arbitrary div: use a local CSS overlay instead.
    if (typeof stage.requestFullscreen === "function") {
      try {
        await stage.requestFullscreen();
        syncFullscreenControls();
        return;
      } catch (_) { /* Fall back to an in-page full-screen stage. */ }
    }
    stage.classList.add("fullscreen-fallback");
    syncFullscreenControls();
  }
  function closeCamera() {
    exitLocalFullscreen();
    destroyMedia(); if ($("viewer").open) $("viewer").close();
  }
  function saveCustom(cam) {
    sources.custom.push(cam); safeWrite(STORAGE_CUSTOM,sources.custom); render();
  }
  // GPS is opt-in. Precise coordinates are held only in memory, never in localStorage,
  // camera requests, camera URLs, analytics, or the GitHub repository.
  function gpsSetStatus(message) {
    $("gpsStatus").textContent = message;
  }
  function updateFollowButton() {
    const button = $("followBtn");
    button.disabled = gpsWatchId === null;
    button.setAttribute("aria-pressed", String(gpsFollow));
    button.textContent = gpsFollow ? "⌖ Following" : "⌖ Follow me";
    button.classList.toggle("gps-following", gpsFollow && gpsWatchId !== null);
  }
  function stopGPS() {
    if (gpsWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(gpsWatchId);
    }
    gpsWatchId = null;
    gpsLastFix = null;
    gpsFirstFix = true;
    gpsFollow = true;
    if (gpsMarker) { map.removeLayer(gpsMarker); gpsMarker = null; }
    if (gpsAccuracyCircle) { map.removeLayer(gpsAccuracyCircle); gpsAccuracyCircle = null; }
    $("nearBtn").textContent = "◎ Start GPS";
    $("nearBtn").setAttribute("aria-pressed", "false");
    $("nearBtn").classList.remove("gps-on");
    gpsSetStatus("GPS off");
    updateFollowButton();
  }
  function onGPSPosition(position) {
    if (gpsWatchId === null) return; // Ignore stale callbacks after Stop.
    const coords = position && position.coords;
    if (!coords || !validPosition(coords.latitude, coords.longitude)) {
      gpsSetStatus("GPS returned an invalid position"); return;
    }
    const location = [coords.latitude, coords.longitude];
    const accuracy = Number.isFinite(coords.accuracy) ? Math.max(1,coords.accuracy) : 0;
    gpsLastFix = location;
    if (!gpsAccuracyCircle) {
      gpsAccuracyCircle = L.circle(location,{
        radius:accuracy || 25, color:"#167ad7", weight:1, opacity:.6,
        fillColor:"#3596eb", fillOpacity:.14, interactive:false
      }).addTo(map);
    } else {
      gpsAccuracyCircle.setLatLng(location);
      if (accuracy) gpsAccuracyCircle.setRadius(accuracy);
    }
    if (!gpsMarker) {
      gpsMarker = L.circleMarker(location,{
        radius:8, color:"#fff", weight:3, fillColor:"#087af5", fillOpacity:1,
        className:"own-location", pane:"markerPane"
      }).addTo(map);
    } else {
      gpsMarker.setLatLng(location);
    }
    const updated = new Date(position.timestamp || Date.now()).toLocaleTimeString();
    const label = "You are here" + (accuracy ? " · accuracy ±" + Math.round(accuracy) + " m" : "") + " · " + updated;
    gpsMarker.bindTooltip(label, {direction:"top",offset:[0,-10]});
    gpsMarker.bindPopup(label + "<br>GPS position stays on this device.");
    gpsSetStatus("● GPS live" + (accuracy ? " · ±" + Math.round(accuracy) + " m" : "") + " · " + updated);
    if (gpsFollow) {
      if (gpsFirstFix) map.setView(location, Math.max(map.getZoom(), accuracy > 250 ? 12 : 14));
      else map.panTo(location, {animate:false});
    }
    gpsFirstFix = false;
  }
  function onGPSError(error) {
    if (gpsWatchId === null) return;
    if (error && error.code === 1) {
      stopGPS();
      gpsSetStatus("Location denied — enable GPS permission for this site");
      toast("Location permission denied. Allow location in your browser settings.");
    } else if (error && error.code === 2) {
      gpsSetStatus("GPS unavailable — check device location settings");
    } else if (error && error.code === 3) {
      gpsSetStatus("Waiting for GPS signal — location timed out");
    } else {
      gpsSetStatus("GPS could not obtain a location");
    }
  }
  function startGPS() {
    if (gpsWatchId !== null) return;
    if (!navigator.geolocation || !window.isSecureContext) {
      gpsSetStatus("GPS needs HTTPS and a browser with location support");
      toast("Location needs HTTPS and geolocation support"); return;
    }
    gpsFollow = true; gpsFirstFix = true;
    gpsSetStatus("Requesting GPS access…");
    try {
      gpsWatchId = navigator.geolocation.watchPosition(
        onGPSPosition, onGPSError,
        {enableHighAccuracy:true,maximumAge:5000,timeout:20000}
      );
    } catch (error) {
      gpsWatchId = null;
      gpsSetStatus("Unable to start GPS");
      toast("GPS could not start: " + error.message);
      return;
    }
    $("nearBtn").textContent = "■ Stop GPS";
    $("nearBtn").setAttribute("aria-pressed", "true");
    $("nearBtn").classList.add("gps-on");
    updateFollowButton();
  }

  function setupEvents() {
    $("sourceFilter").addEventListener("change",render);
    $("search").addEventListener("input",render);
    $("district").addEventListener("change",() => {
      const selectedDistrict = $("district").value;
      $("search").value = "";
      if (selectedDistrict !== "all") {
        const id = Number(selectedDistrict);
        map.setView(DISTRICT_CENTERS[id] || LOCAL,id === 6 ? 9 : 8);
      }
      // All districts preserves the map position and shows cameras nearest that position first.
      loadCaltrans();
    });
    $("refreshBtn").addEventListener("click",() => {
      sourceErrors.caltrans = sourceErrors.alertca = sourceErrors.caloes = "";
      loadCaltrans({refresh:true}); loadOtherSources(); toast("Refreshing public camera listings");
    });
    $("localBtn").addEventListener("click",() => {
      $("search").value = ""; onlyWithinMap = false;
      $("onlyViewBtn").classList.remove("active");
      $("onlyViewBtn").setAttribute("aria-pressed","false");
      $("onlyViewBtn").textContent = "☐ In map";
      if (gpsWatchId !== null) { gpsFollow = false; updateFollowButton(); }
      map.setView(LOCAL,11); render();
    });
    $("dosPalosBtn").addEventListener("click",() => {
      $("search").value = ""; onlyWithinMap = false;
      $("onlyViewBtn").classList.remove("active");
      $("onlyViewBtn").setAttribute("aria-pressed","false");
      $("onlyViewBtn").textContent = "☐ In map";
      if (gpsWatchId !== null) { gpsFollow = false; updateFollowButton(); }
      map.setView(DOS_PALOS,10); render();
    });
    $("onlyViewBtn").addEventListener("click",() => {
      onlyWithinMap = !onlyWithinMap;
      $("onlyViewBtn").classList.toggle("active",onlyWithinMap);
      $("onlyViewBtn").setAttribute("aria-pressed",String(onlyWithinMap));
      $("onlyViewBtn").textContent = (onlyWithinMap ? "☑" : "☐") + " In map";
      render();
    });
    $("nearBtn").addEventListener("click",() => {
      if (gpsWatchId === null) startGPS(); else stopGPS();
    });
    $("followBtn").addEventListener("click",() => {
      if (gpsWatchId === null) return;
      gpsFollow = !gpsFollow;
      updateFollowButton();
      if (gpsFollow && gpsLastFix) map.panTo(gpsLastFix, {animate:true});
    });
    $("closeViewer").addEventListener("click",closeCamera);
    $("fullscreenBtn").addEventListener("click",toggleLocalFullscreen);
    $("exitFullscreenBtn").addEventListener("click",exitLocalFullscreen);
    document.addEventListener("fullscreenchange",syncFullscreenControls);
    document.addEventListener("keydown",(event) => {
      if (event.key === "Escape" && $("mediaStage").classList.contains("fullscreen-fallback")) {
        event.preventDefault(); event.stopPropagation(); exitLocalFullscreen();
      }
    },true);
    $("viewer").addEventListener("close",() => { exitLocalFullscreen(); destroyMedia(); });
    $("viewer").addEventListener("click",(event) => { if (event.target === $("viewer")) closeCamera(); });
    $("playBtn").addEventListener("click",playLive);
    $("snapshotBtn").addEventListener("click",showSnapshot);
    $("favBtn").addEventListener("click",() => {
      if (!selected) return;
      if (favorites.has(selected.id)) favorites.delete(selected.id); else favorites.add(selected.id);
      safeWrite(STORAGE_FAV,Array.from(favorites));
      $("favBtn").textContent = favorites.has(selected.id) ? "★ Favorited" : "☆ Favorite";
      render();
    });
    $("removeCustom").addEventListener("click",() => {
      if (!selected || selected.source !== "custom") return;
      const name = selected.name;
      sources.custom = sources.custom.filter((c) => c.id !== selected.id);
      favorites.delete(selected.id);
      safeWrite(STORAGE_FAV,Array.from(favorites));
      safeWrite(STORAGE_CUSTOM,sources.custom);
      closeCamera(); selected = null; render(); toast("Removed " + name);
    });
    $("addBtn").addEventListener("click",() => $("addDialog").showModal());
    $("closeAdd").addEventListener("click",() => $("addDialog").close());
    $("cancelAdd").addEventListener("click",() => $("addDialog").close());
    $("pinBtn").addEventListener("click",() => {
      placingPin = true; $("addDialog").close();
      toast("Tap the map to choose the public camera location");
      map.getContainer().style.cursor = "crosshair";
    });
    $("addForm").addEventListener("submit",(ev) => {
      ev.preventDefault();
      const url = validUrl($("newURL").value);
      const page = validUrl($("newPage").value);
      const lat = Number($("newLat").value), lng = Number($("newLng").value);
      if (!url || !url.startsWith("https://")) {
        $("addError").textContent = "Use an HTTPS public URL that is intentionally published by its operator."; return;
      }
      if ($("newPage").value.trim() && !page) {
        $("addError").textContent = "Provider webpage URL is invalid."; return;
      }
      if (!validPosition(lat,lng)) {
        $("addError").textContent = "Enter valid non-zero map coordinates."; return;
      }
      const kind = mediaKind(url);
      const cam = normalized({
        id:"custom:" + Date.now() + "-" + Math.random().toString(36).slice(2,7),
        source:"custom", name:$("newName").value.trim(), operator:$("newOperator").value.trim() || "Public camera (user-added)",
        lat,lng, location:"Added on this device",route:"Custom",
        stream:kind === "link" ? "" : url,
        snapshot:kind === "image" ? url : "",
        page:page || (kind === "link" ? url : ""),status:"Unverified custom listing",refresh:2
      });
      if (!cam) { $("addError").textContent = "Invalid camera location."; return; }
      $("addError").textContent = "";
      saveCustom(cam); $("addDialog").close(); $("addForm").reset();
      $("sourceFilter").value = "all"; map.setView([lat,lng],13); render(); openCamera(cam);
      toast("Public camera saved on this device");
    });
  }

  if (!window.L) {
    $("status").textContent = "Map library did not load. Check your internet connection.";
    return;
  }
  const map = L.map("map",{zoomControl:true,preferCanvas:true}).setView(LOCAL,11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
    maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  cluster = typeof L.markerClusterGroup === "function"
    ? L.markerClusterGroup({showCoverageOnHover:false, maxClusterRadius:45, disableClusteringAtZoom:14})
    : L.layerGroup();
  map.addLayer(cluster);
  map.on("moveend",() => { render(); scheduleOtherSources(); });
  map.on("dragstart",() => {
    if (gpsWatchId !== null && gpsFollow) {
      gpsFollow = false;
      updateFollowButton();
    }
  });
  map.on("click",(ev) => {
    if (!placingPin) return;
    placingPin = false;
    map.getContainer().style.cursor = "";
    $("newLat").value = ev.latlng.lat.toFixed(6);
    $("newLng").value = ev.latlng.lng.toFixed(6);
    $("addDialog").showModal();
    toast("Location selected; add the public feed URL");
  });
  setupEvents();
  loadCustom();
  render();
  loadCaltrans();
  loadOtherSources();
})();
