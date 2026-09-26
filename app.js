const MAX_USABLE_ACCURACY_METERS = 100;
const GEOCODE_MIN_INTERVAL_MS = 20_000;
const GSI_REVERSE_GEOCODER = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress";
const GSI_MUNICIPALITIES = "https://maps.gsi.go.jp/js/muni.js";

const elements = {
  start: document.querySelector("#start"),
  welcome: document.querySelector("#welcome"),
  result: document.querySelector("#result"),
  status: document.querySelector("#status"),
  place: document.querySelector("#place"),
  accuracy: document.querySelector("#accuracy"),
  coordinates: document.querySelector("#coordinates"),
  dataUsage: document.querySelector("#data-usage"),
  updated: document.querySelector("#updated"),
  pulse: document.querySelector("#pulse"),
};

let watchId = null;
let municipalityNames = null;
let lastGeocodedAt = 0;
let receivedBytes = 0;

function formatBytes(bytes) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(2)} MB`;
}

function recordReceivedBytes(text) {
  receivedBytes += new TextEncoder().encode(text).byteLength;
  elements.dataUsage.textContent = `このアプリの受信量（概算） ${formatBytes(receivedBytes)}`;
}

async function fetchText(url) {
  const response = await fetch(url);
  const text = await response.text();
  recordReceivedBytes(text);
  if (!response.ok) throw new Error("通信に失敗しました");
  return text;
}

function loadMunicipalities() {
  if (municipalityNames) return Promise.resolve(municipalityNames);

  return fetchText(GSI_MUNICIPALITIES)
    .then((source) => {
      const names = new Map();
      const pattern = /GSI\.MUNI_ARRAY\["(\d+)"\]\s*=\s*'([^']+)'/g;
      for (const match of source.matchAll(pattern)) {
        const [, code, value] = match;
        const [, prefecture, , municipality] = value.split(",");
        names.set(code, `${prefecture}${municipality}`);
      }
      municipalityNames = names;
      return names;
    });
}

async function reverseGeocode(latitude, longitude) {
  const url = new URL(GSI_REVERSE_GEOCODER);
  url.searchParams.set("lat", latitude);
  url.searchParams.set("lon", longitude);

  const [source, names] = await Promise.all([fetchText(url), loadMunicipalities()]);
  const data = JSON.parse(source);
  const result = data.results;
  if (!result) return "地名を特定できない場所";

  const municipality = names.get(String(result.muniCd)) ?? "";
  const locality = result.lv01Nm ?? "";
  return `${municipality}${locality}` || "地名を特定できない場所";
}

function positionErrorMessage(error) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "位置情報が許可されていません";
    case error.POSITION_UNAVAILABLE:
      return "GPSを受信できません";
    case error.TIMEOUT:
      return "GPSの取得に時間がかかっています";
    default:
      return "現在地を取得できませんでした";
  }
}

async function showPosition(position) {
  const { latitude, longitude, accuracy } = position.coords;

  // `accuracy` is the browser's estimated radius of uncertainty. Do not turn a
  // coarse Wi-Fi/cell estimate into a misleadingly precise place name.
  if (!Number.isFinite(accuracy) || accuracy > MAX_USABLE_ACCURACY_METERS) {
    const accuracyLabel = Number.isFinite(accuracy) ? `±${Math.round(accuracy)} m` : "不明";
    elements.status.textContent = `高精度の位置情報を待機中（現在の推定誤差 ${accuracyLabel}）`;
    elements.status.classList.add("error");
    elements.updated.textContent = "屋外でしばらくお待ちください";
    elements.pulse.classList.remove("active");
    return;
  }

  elements.status.classList.remove("error");
  elements.accuracy.textContent = `±${Math.round(accuracy)} m`;
  elements.coordinates.textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  elements.updated.textContent = `${new Date(position.timestamp).toLocaleTimeString("ja-JP")} 更新`;
  elements.pulse.classList.add("active");
  elements.status.textContent = "高精度で追跡中";

  if (Date.now() - lastGeocodedAt < GEOCODE_MIN_INTERVAL_MS) return;
  lastGeocodedAt = Date.now();
  try {
    elements.place.textContent = await reverseGeocode(latitude, longitude);
  } catch (error) {
    console.error(error);
    elements.place.textContent = "地名を取得できません";
  }
}

function startWatching() {
  elements.status.textContent = "GPS信号を待機中…";
  watchId = navigator.geolocation.watchPosition(showPosition, (error) => {
    elements.status.textContent = positionErrorMessage(error);
    elements.status.classList.add("error");
    elements.updated.textContent = "位置情報の設定を確認してください";
    elements.pulse.classList.remove("active");
  }, {
    enableHighAccuracy: true,
    timeout: 30_000,
    maximumAge: 0,
  });
}

function start() {
  if (!("geolocation" in navigator)) {
    elements.status.textContent = "この端末は位置情報に対応していません";
    elements.status.classList.add("error");
    return;
  }

  elements.welcome.hidden = true;
  elements.result.hidden = false;
  startWatching();
}

elements.start.addEventListener("click", start, { once: true });

window.addEventListener("pagehide", () => {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));
}
