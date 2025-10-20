// remote-api.js
// ES module that intercepts /api/toilets fetches and routes them to Firestore.
// Also provides simple admin UI for approval (email/password login using Firebase Auth).

// ====== 1) Firebase config - Замените на свой объект ======
const firebaseConfig = {
  apiKey: "AIzaSyAClqLGSXKh2HpnW4v65bLbrNHOlpnhYmc",
  authDomain: "wc-map-ua.firebaseapp.com",
  projectId: "wc-map-ua",
  storageBucket: "wc-map-ua.firebasestorage.app",
  messagingSenderId: "136445190783",
  appId: "1:136445190783:web:e314d3cc22a3eba9be954a"
};
// ==========================================================

if (!firebaseConfig || !firebaseConfig.apiKey) {
  console.error("remote-api: Firebase config not provided. Edit remote-api.js and paste your firebaseConfig.");
}

// ====== 2) Импорты из CDN (ESM) ======
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, query, where, getDocs, orderBy, serverTimestamp,
  doc, updateDoc, deleteDoc, getDoc
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

// ====== 3) Инициализация ======
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const toiletsCol = collection(db, "toilets");

// ====== 4) Утилиты ======
function nowIso(){ return (new Date()).toISOString(); }
function uid(len=8){
  const s = Math.random().toString(36).slice(2, 2+len);
  return Date.now().toString(36) + "-" + s;
}
function jsonResponse(obj, status=200){
  return Promise.resolve(new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  }));
}

// haversine (km)
function toRad(v){ return v * Math.PI / 180; }
function distanceKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// parse body helper
async function parseBody(input, init){
  if (init && init.body) {
    try { return JSON.parse(init.body); } catch(e){ return null; }
  }
  if (input instanceof Request) {
    try { return await input.json(); } catch(e){ return null; }
  }
  return null;
}

// ====== 5) Firestore operations ======
async function fetchApprovedToiletsNearby(lat, lon, radiusKm = 50) {
  // fetch all approved toilets, then filter by distance client-side
  const q = query(toiletsCol, where("isApproved", "==", true), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach(docSnap => {
    const d = docSnap.data();
    const obj = { id: docSnap.id, ...d };
    if (lat !== null && lon !== null) {
      obj.distance = distanceKm(lat, lon, obj.latitude, obj.longitude);
    }
    list.push(obj);
  });
  if (lat !== null && lon !== null) {
    return list.filter(t => t.distance <= radiusKm).sort((a,b)=>a.distance - b.distance);
  }
  return list;
}

async function createToiletInFirestore(body) {
  const docRef = await addDoc(toiletsCol, {
    name: body.name,
    latitude: Number(body.latitude),
    longitude: Number(body.longitude),
    description: body.description || "",
    isAccessible: !!body.isAccessible,
    isFree: body.isFree === undefined ? true : !!body.isFree,
    hasBabyChanging: !!body.hasBabyChanging,
    isApproved: false,
    submittedBy: body.submittedBy || "web",
    createdAt: serverTimestamp()
  });
  const saved = await getDoc(docRef);
  return { id: docRef.id, ...saved.data() };
}

async function updateToiletInFirestore(id, data) {
  const dRef = doc(db, "toilets", id);
  await updateDoc(dRef, data);
  const updated = await getDoc(dRef);
  return { id: updated.id, ...updated.data() };
}

async function deleteToiletInFirestore(id) {
  const dRef = doc(db, "toilets", id);
  await deleteDoc(dRef);
  return true;
}

// ====== 6) Fetch interceptor ======
const origFetch = window.fetch.bind(window);
window.fetch = async function(input, init){
  let url = (typeof input === "string") ? input : (input && input.url) || "";
  if (url.includes("/api/toilets")) {
    try {
      const method = (init && init.method) ? init.method.toUpperCase() : (input && input.method) ? input.method.toUpperCase() : "GET";

      // GET /api/toilets?lat=&lon=&radius=
      if (method === "GET") {
        const u = new URL(url, location.origin);
        const lat = u.searchParams.get("lat");
        const lon = u.searchParams.get("lon");
        const radius = u.searchParams.get("radius") ? parseFloat(u.searchParams.get("radius")) : 50;
        const latN = lat ? parseFloat(lat) : null;
        const lonN = lon ? parseFloat(lon) : null;
        const list = await fetchApprovedToiletsNearby(latN, lonN, radius);
        return jsonResponse(list, 200);
      }

      // POST -> create new (anyone)
      if (method === "POST") {
        const body = await parseBody(input, init);
        if (!body || !body.name || body.latitude === undefined || body.longitude === undefined) {
          return jsonResponse({ error: "Invalid data" }, 400);
        }
        const created = await createToiletInFirestore(body);
        return jsonResponse(created, 201);
      }

      // PATCH -> update (admin only)
      if (method === "PATCH") {
        // require auth
        const body = await parseBody(input, init);
        // get id from url /api/toilets/:id
        const parts = url.split("/").filter(Boolean);
        const id = parts[parts.length - 1];
        if (!id) return jsonResponse({ error: "Missing id" }, 400);
        if (!auth.currentUser) return jsonResponse({ error: "Not authenticated" }, 403);
        const updated = await updateToiletInFirestore(id, body);
        return jsonResponse(updated, 200);
      }

      // DELETE -> admin only
      if (method === "DELETE") {
        const parts = url.split("/").filter(Boolean);
        const id = parts[parts.length - 1];
        if (!id) return jsonResponse({ error: "Missing id" }, 400);
        if (!auth.currentUser) return jsonResponse({ error: "Not authenticated" }, 403);
        await deleteToiletInFirestore(id);
        return jsonResponse({ success: true }, 204);
      }

      return jsonResponse({ error: "Not implemented" }, 501);
    } catch (e) {
      console.error("remote-api fetch error:", e);
      return jsonResponse({ error: "internal" }, 500);
    }
  }
  return origFetch(input, init);
};

// ====== 7) Admin UI overlay (simple) ======
(function createAdminUI(){
  // floating tiny button (almost invisible)
  const btn = document.createElement("div");
  btn.title = "admin";
  btn.style.position = "fixed";
  btn.style.right = "6px";
  btn.style.bottom = "6px";
  btn.style.width = "28px";
  btn.style.height = "28px";
  btn.style.borderRadius = "6px";
  btn.style.background = "rgba(0,0,0,0.06)";
  btn.style.zIndex = 999999;
  btn.style.backdropFilter = "blur(2px)";
  btn.style.display = "flex";
  btn.style.alignItems = "center";
  btn.style.justifyContent = "center";
  btn.style.cursor = "pointer";
  btn.style.border = "1px solid rgba(0,0,0,0.08)";
  btn.innerText = "•";
  document.body.appendChild(btn);

  let panel = null;

  async function openPanel(){
    if (!panel) {
      panel = document.createElement("div");
      panel.style.position = "fixed";
      panel.style.right = "10px";
      panel.style.bottom = "50px";
      panel.style.width = "360px";
      panel.style.maxHeight = "70vh";
      panel.style.overflow = "auto";
      panel.style.background = "white";
      panel.style.border = "1px solid rgba(0,0,0,0.12)";
      panel.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)";
      panel.style.zIndex = 999999;
      panel.style.padding = "12px";
      panel.style.fontFamily = "Inter, Arial, sans-serif";
      document.body.appendChild(panel);
    }
    renderPanel();
  }

  function closePanel(){
    if (panel) panel.remove();
    panel = null;
  }

  function renderPanel(){
    if (!panel) return;
    panel.innerHTML = "";
    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.style.marginBottom = "8px";
    title.innerText = "WCMap — Admin";
    panel.appendChild(title);

    const authStatus = document.createElement("div");
    authStatus.style.marginBottom = "8px";
    authStatus.innerText = auth.currentUser ? `Signed in: ${auth.currentUser.email}` : "Not signed in";
    panel.appendChild(authStatus);

    const loginBtn = document.createElement("button");
    loginBtn.innerText = auth.currentUser ? "Sign out" : "Sign in (email)";
    loginBtn.style.marginRight = "8px";
    loginBtn.onclick = async () => {
      if (auth.currentUser) {
        await signOut(auth);
        renderPanel();
        return;
      }
      const email = prompt("Admin email:");
      const pass = prompt("Password:");
      if (!email || !pass) return alert("Cancelled");
      try {
        await signInWithEmailAndPassword(auth, email, pass);
        alert("Signed in");
        renderPanel();
      } catch (err) {
        alert("Sign in failed: " + err.message);
        console.error(err);
      }
    };
    panel.appendChild(loginBtn);

    // Only show moderation if signed in
    if (!auth.currentUser) {
      const hint = document.createElement("div");
      hint.style.fontSize = "13px";
      hint.style.marginTop = "10px";
      hint.innerText = "Sign in to see pending toilets and moderate.";
      panel.appendChild(hint);
      return;
    }

    const refreshBtn = document.createElement("button");
    refreshBtn.innerText = "Refresh pending";
    refreshBtn.style.marginLeft = "8px";
    refreshBtn.onclick = () => loadPending();
    panel.appendChild(refreshBtn);

    const listWrap = document.createElement("div");
    listWrap.style.marginTop = "12px";
    panel.appendChild(listWrap);

    async function loadPending(){
      listWrap.innerHTML = "Loading...";
      try {
        // fetch all toilets (admin can read all because auth is present)
        // We'll query where isApproved == false
        const q = query(toiletsCol, where("isApproved", "==", false), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        listWrap.innerHTML = "";
        if (snap.empty) {
          listWrap.innerText = "No pending toilets";
          return;
        }
        snap.forEach(docSnap => {
          const d = { id: docSnap.id, ...docSnap.data() };
          const item = document.createElement("div");
          item.style.borderTop = "1px solid rgba(0,0,0,0.06)";
          item.style.paddingTop = "8px";
          item.style.paddingBottom = "8px";

          const h = document.createElement("div");
          h.style.fontWeight = "600";
          h.innerText = d.name || "(no name)";
          item.appendChild(h);

          const p = document.createElement("div");
          p.style.fontSize = "13px";
          p.style.color = "#333";
          p.innerText = `coords: ${d.latitude}, ${d.longitude}\n${d.description || ""}`;
          item.appendChild(p);

          const btns = document.createElement("div");
          btns.style.marginTop = "8px";

          const approve = document.createElement("button");
          approve.innerText = "Approve";
          approve.onclick = async () => {
            try {
              await updateToiletInFirestore(d.id, { isApproved: true });
              item.style.opacity = 0.5;
              alert("Approved");
              loadPending();
            } catch (e) {
              alert("Failed to approve: " + e.message);
              console.error(e);
            }
          };
          btns.appendChild(approve);

          const del = document.createElement("button");
          del.innerText = "Delete";
          del.style.marginLeft = "8px";
          del.onclick = async () => {
            if (!confirm("Delete this toilet?")) return;
            try {
              await deleteToiletInFirestore(d.id);
              item.remove();
            } catch (e) {
              alert("Failed to delete: " + e.message);
              console.error(e);
            }
          };
          btns.appendChild(del);

          item.appendChild(btns);
          listWrap.appendChild(item);
        });
      } catch (err) {
        listWrap.innerText = "Error loading pending: " + err.message;
        console.error(err);
      }
    }

    // load initially
    loadPending();
  }

  btn.addEventListener("click", () => {
    if (!panel) openPanel(); else closePanel();
  });

  // update admin panel when auth changes
  onAuthStateChanged(auth, (user) => {
    if (panel) renderPanel();
    console.log("remote-api: auth change", user && user.email);
  });

})();
