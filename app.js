const CATEGORIES = [
  "上衣",
  "下装",
  "裙子",
  "连衣裙",
  "外套",
  "鞋",
  "包",
  "项链",
  "耳环",
  "手链",
  "戒指",
  "丝袜袜子",
  "其他",
];

const OLD_DEFAULT_LOCATIONS = ["主卧衣柜", "左侧挂区", "右侧挂区", "抽屉", "收纳箱", "首饰盒", "鞋柜", "其他"];

const DEFAULT_PLACEMENTS = {
  上衣: { x: 50, y: 34, scale: 0.88, rotation: 0, zIndex: 40 },
  外套: { x: 50, y: 35, scale: 0.98, rotation: 0, zIndex: 50 },
  下装: { x: 50, y: 57, scale: 0.9, rotation: 0, zIndex: 25 },
  裙子: { x: 50, y: 58, scale: 0.96, rotation: 0, zIndex: 28 },
  连衣裙: { x: 50, y: 48, scale: 1.05, rotation: 0, zIndex: 30 },
  鞋: { x: 50, y: 88, scale: 0.62, rotation: 0, zIndex: 60 },
  包: { x: 72, y: 52, scale: 0.58, rotation: 0, zIndex: 70 },
  项链: { x: 50, y: 25, scale: 0.36, rotation: 0, zIndex: 82 },
  耳环: { x: 50, y: 18, scale: 0.32, rotation: 0, zIndex: 84 },
  手链: { x: 70, y: 48, scale: 0.28, rotation: 0, zIndex: 86 },
  戒指: { x: 72, y: 54, scale: 0.18, rotation: 0, zIndex: 88 },
  丝袜袜子: { x: 50, y: 70, scale: 0.86, rotation: 0, zIndex: 20 },
  其他: { x: 50, y: 50, scale: 0.6, rotation: 0, zIndex: 90 },
};

const DB_NAME = "wardrobe-local-db";
const DB_VERSION = 1;

const state = {
  page: "closet",
  filterMode: "category",
  activeFilter: "全部",
  dressCategory: "上衣",
  garments: [],
  locations: [],
  outfits: [],
  images: new Map(),
  currentImageSet: null,
  editingGarmentId: null,
  detailGarmentId: null,
  mannequinImageId: null,
  layers: [],
  selectedLayerId: null,
  undoStack: [],
  editingOutfitId: null,
};

const $ = (id) => document.getElementById(id);
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let db;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  db = await openDb();
  await requestStoragePersistence();
  await refreshData();
  await removeUnusedDefaultLocations();
  await refreshData();
  wireEvents();
  populateCategorySelect();
  renderAll();
}

async function requestStoragePersistence() {
  if (!navigator.storage || !navigator.storage.persist) return;
  try {
    await navigator.storage.persist();
  } catch (error) {
    console.info("Storage persistence request was not granted.", error);
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      ["garments", "locations", "outfits", "images", "settings"].forEach((store) => {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: "id" });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(store, mode = "readonly") {
  return db.transaction(store, mode).objectStore(store);
}

function getAll(store) {
  return new Promise((resolve, reject) => {
    const request = tx(store).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function put(store, value) {
  return new Promise((resolve, reject) => {
    const request = tx(store, "readwrite").put(value);
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

function del(store, id) {
  return new Promise((resolve, reject) => {
    const request = tx(store, "readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function clearStore(store) {
  return new Promise((resolve, reject) => {
    const request = tx(store, "readwrite").clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function refreshData() {
  state.garments = await getAll("garments");
  state.locations = await getAll("locations");
  state.outfits = await getAll("outfits");
  const images = await getAll("images");
  state.images = new Map(images.map((image) => [image.id, image]));
  const settings = await getAll("settings");
  state.mannequinImageId = settings.find((item) => item.id === "mannequinImageId")?.value || null;
}

async function removeUnusedDefaultLocations() {
  const usedLocations = new Set(state.garments.map((garment) => garment.locationName).filter(Boolean));
  const unusedDefaults = state.locations.filter((location) => OLD_DEFAULT_LOCATIONS.includes(location.name) && !usedLocations.has(location.name));
  for (const location of unusedDefaults) await del("locations", location.id);
}

function wireEvents() {
  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.page));
  });

  document.querySelectorAll("[data-filter-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filterMode = button.dataset.filterMode;
      state.activeFilter = "全部";
      renderCloset();
    });
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => $(button.dataset.closeDialog).close());
  });

  $("addGarmentBtn").addEventListener("click", () => openGarmentForm());
  $("settingsBtn").addEventListener("click", () => $("settingsDialog").showModal());
  $("closetSearch").addEventListener("input", renderCloset);
  $("outfitSearch").addEventListener("input", renderOutfits);
  $("garmentImageInput").addEventListener("change", onGarmentImage);
  $("garmentForm").addEventListener("submit", saveGarment);

  $("detailEditBtn").addEventListener("click", () => {
    const garment = state.garments.find((item) => item.id === state.detailGarmentId);
    $("detailDialog").close();
    openGarmentForm(garment);
  });
  $("detailDressBtn").addEventListener("click", async () => {
    const garment = state.garments.find((item) => item.id === state.detailGarmentId);
    $("detailDialog").close();
    setPage("dress");
    await addGarmentToStage(garment);
  });
  $("detailDeleteBtn").addEventListener("click", deleteDetailGarment);

  $("changeMannequinBtn").addEventListener("click", () => $("mannequinInput").click());
  $("mannequinInput").addEventListener("change", onMannequinImage);
  $("clearLayersBtn").addEventListener("click", clearLayers);
  $("undoBtn").addEventListener("click", undoLayerChange);
  $("saveOutfitBtn").addEventListener("click", openSaveOutfit);
  $("saveCanvasBtn").addEventListener("click", openSaveOutfit);
  $("outfitNameForm").addEventListener("submit", saveOutfit);
  $("scaleRange").addEventListener("input", updateSelectedTransform);
  $("rotateRange").addEventListener("input", updateSelectedTransform);
  $("removeLayerBtn").addEventListener("click", removeSelectedLayer);

  $("manageLocationsBtn").addEventListener("click", () => {
    $("settingsDialog").close();
    renderLocations();
    $("locationsDialog").showModal();
  });
  $("locationForm").addEventListener("submit", addLocation);
  $("exportBtn").addEventListener("click", exportBackup);
  $("importBtn").addEventListener("click", () => $("importInput").click());
  $("importInput").addEventListener("change", importBackup);
  $("clearAllBtn").addEventListener("click", clearAllData);
}

function populateCategorySelect() {
  $("garmentCategory").innerHTML = CATEGORIES.map((cat) => `<option value="${cat}">${cat}</option>`).join("");
}

function renderAll() {
  renderTopbar();
  renderCloset();
  renderDress();
  renderOutfits();
  renderLocationOptions();
}

function setPage(page) {
  state.page = page;
  document.querySelectorAll(".page").forEach((pageEl) => pageEl.classList.remove("active"));
  $(`${page}Page`).classList.add("active");
  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  $("addGarmentBtn").classList.toggle("hidden", page !== "closet");
  renderTopbar();
  if (page === "dress") renderDress();
  if (page === "outfits") renderOutfits();
}

function renderTopbar() {
  const titles = {
    closet: ["本地衣橱", "我的衣橱"],
    dress: ["人体换装", "换装"],
    outfits: ["保存记录", "我的搭配"],
  };
  $("pageEyebrow").textContent = titles[state.page][0];
  $("pageTitle").textContent = titles[state.page][1];
}

function renderCloset() {
  document.querySelectorAll("[data-filter-mode]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.filterMode === state.filterMode);
  });

  const chips = state.filterMode === "category" ? ["全部", ...CATEGORIES] : ["全部", ...locationNames()];
  $("closetFilterChips").innerHTML = chips
    .map((chip) => `<button class="${chip === state.activeFilter ? "selected" : ""}" type="button">${escapeHtml(chip)}</button>`)
    .join("");
  [...$("closetFilterChips").children].forEach((button) => {
    button.addEventListener("click", () => {
      state.activeFilter = button.textContent;
      renderCloset();
    });
  });

  const query = $("closetSearch").value.trim().toLowerCase();
  const garments = state.garments
    .filter((garment) => {
      if (state.activeFilter === "全部") return true;
      if (state.filterMode === "category") return garment.category === state.activeFilter;
      return garment.locationName === state.activeFilter;
    })
    .filter((garment) => {
      if (!query) return true;
      return [garment.name, garment.category, garment.locationName, garment.colors, garment.seasons, garment.styles, garment.notes]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  $("closetEmpty").classList.toggle("show", garments.length === 0);
  $("garmentGrid").innerHTML = garments.map(renderGarmentCard).join("");
  [...$("garmentGrid").children].forEach((card) => {
    card.addEventListener("click", () => openDetail(card.dataset.id));
  });
}

function renderGarmentCard(garment) {
  const image = state.images.get(garment.thumbnailImageId)?.dataUrl || "";
  return `
    <button class="garment-card" data-id="${garment.id}" type="button">
      <img src="${image}" alt="${escapeAttr(garment.name)}" />
      <div>
        <strong>${escapeHtml(garment.name)}</strong>
        <span>${escapeHtml(garment.category)} · ${escapeHtml(garment.locationName || "未设置")}</span>
      </div>
    </button>
  `;
}

function renderLocationOptions() {
  $("locationOptions").innerHTML = locationNames().map((name) => `<option value="${escapeAttr(name)}"></option>`).join("");
}

function openGarmentForm(garment = null) {
  state.editingGarmentId = garment?.id || null;
  state.currentImageSet = null;
  $("garmentFormTitle").textContent = garment ? "编辑衣物" : "新增衣物";
  $("garmentId").value = garment?.id || "";
  $("garmentName").value = garment?.name || "";
  $("garmentCategory").value = garment?.category || CATEGORIES[0];
  $("garmentLocation").value = garment?.locationName || "";
  $("garmentColors").value = garment?.colors || "";
  $("garmentSeasons").value = garment?.seasons || "";
  $("garmentStyles").value = garment?.styles || "";
  $("garmentNotes").value = garment?.notes || "";
  $("garmentImageInput").value = "";
  const image = garment ? state.images.get(garment.thumbnailImageId)?.dataUrl : "";
  $("garmentPreview").src = image || "";
  $("garmentPreview").classList.toggle("hidden", !image);
  $("garmentUploadText").classList.toggle("hidden", Boolean(image));
  $("garmentDialog").showModal();
}

async function onGarmentImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  state.currentImageSet = await processImage(file);
  $("garmentPreview").src = state.currentImageSet.thumbnail.dataUrl;
  $("garmentPreview").classList.remove("hidden");
  $("garmentUploadText").classList.add("hidden");
}

async function saveGarment(event) {
  event.preventDefault();
  const existing = state.garments.find((item) => item.id === state.editingGarmentId);
  if (!existing && !state.currentImageSet) {
    alert("请先上传图片。");
    return;
  }

  const locationName = normalizeName($("garmentLocation").value);
  if (locationName) await ensureLocation(locationName);

  let thumbnailImageId = existing?.thumbnailImageId;
  let displayImageId = existing?.displayImageId;
  if (state.currentImageSet) {
    thumbnailImageId = state.currentImageSet.thumbnail.id;
    displayImageId = state.currentImageSet.display.id;
    await put("images", state.currentImageSet.thumbnail);
    await put("images", state.currentImageSet.display);
  }

  const item = {
    id: existing?.id || uid(),
    name: normalizeName($("garmentName").value) || "未命名衣物",
    category: $("garmentCategory").value,
    locationName,
    colors: $("garmentColors").value.trim(),
    seasons: $("garmentSeasons").value.trim(),
    styles: $("garmentStyles").value.trim(),
    notes: $("garmentNotes").value.trim(),
    thumbnailImageId,
    displayImageId,
    createdAt: existing?.createdAt || now(),
    updatedAt: now(),
  };

  await put("garments", item);
  await refreshData();
  renderAll();
  $("garmentDialog").close();
}

function openDetail(id) {
  const garment = state.garments.find((item) => item.id === id);
  if (!garment) return;
  state.detailGarmentId = id;
  $("detailName").textContent = garment.name;
  $("detailImage").src = state.images.get(garment.displayImageId)?.dataUrl || "";
  const fields = [
    ["种类", garment.category],
    ["柜子位置", garment.locationName || "未设置"],
    ["颜色", garment.colors || "未填写"],
    ["季节", garment.seasons || "未填写"],
    ["风格", garment.styles || "未填写"],
    ["备注", garment.notes || "未填写"],
  ];
  $("detailFields").innerHTML = fields.map(([key, val]) => `<dt>${key}</dt><dd>${escapeHtml(val)}</dd>`).join("");
  $("detailDialog").showModal();
}

async function deleteDetailGarment() {
  const garment = state.garments.find((item) => item.id === state.detailGarmentId);
  if (!garment || !confirm(`删除「${garment.name}」吗？`)) return;
  await del("garments", garment.id);
  if (garment.thumbnailImageId) await del("images", garment.thumbnailImageId);
  if (garment.displayImageId) await del("images", garment.displayImageId);
  state.layers = state.layers.filter((layer) => layer.garmentId !== garment.id);
  await refreshData();
  renderAll();
  $("detailDialog").close();
}

function renderDress() {
  renderMannequin();
  renderDressCategories();
  renderShelf();
  renderLayers();
  renderTransformPanel();
}

function renderMannequin() {
  const image = state.mannequinImageId ? state.images.get(state.mannequinImageId)?.dataUrl : "";
  $("mannequinImage").src = image || "";
  $("mannequinImage").classList.toggle("hidden", !image);
  $("mannequinPlaceholder").classList.toggle("hidden", Boolean(image));
}

function renderDressCategories() {
  $("dressCategoryChips").innerHTML = CATEGORIES.map(
    (cat) => `<button class="${cat === state.dressCategory ? "selected" : ""}" type="button">${cat}</button>`
  ).join("");
  [...$("dressCategoryChips").children].forEach((button) => {
    button.addEventListener("click", () => {
      state.dressCategory = button.textContent;
      renderDress();
    });
  });
}

function renderShelf() {
  const garments = state.garments.filter((garment) => garment.category === state.dressCategory);
  $("dressShelf").innerHTML = garments.length
    ? garments
        .map((garment) => {
          const image = state.images.get(garment.thumbnailImageId)?.dataUrl || "";
          return `<button class="shelf-item" data-id="${garment.id}" type="button"><img src="${image}" alt="${escapeAttr(
            garment.name
          )}" /><span>${escapeHtml(garment.name)}</span></button>`;
        })
        .join("")
    : `<div class="empty-state show"><strong>这个分类还没有衣物</strong><span>去衣橱页添加。</span></div>`;
  [...$("dressShelf").querySelectorAll(".shelf-item")].forEach((button) => {
    button.addEventListener("click", async () => {
      const garment = state.garments.find((item) => item.id === button.dataset.id);
      await addGarmentToStage(garment);
    });
  });
}

async function addGarmentToStage(garment) {
  if (!garment) return;
  pushUndo();
  const defaults = DEFAULT_PLACEMENTS[garment.category] || DEFAULT_PLACEMENTS.其他;
  const image = state.images.get(garment.displayImageId);
  const layer = {
    id: uid(),
    garmentId: garment.id,
    name: garment.name,
    category: garment.category,
    imageId: garment.displayImageId,
    imageWidth: image?.width || 400,
    imageHeight: image?.height || 400,
    x: defaults.x,
    y: defaults.y,
    scale: defaults.scale,
    rotation: defaults.rotation,
    zIndex: defaults.zIndex,
  };
  state.layers = state.layers.filter((existing) => existing.category !== garment.category || isAccessory(garment.category));
  state.layers.push(layer);
  state.selectedLayerId = layer.id;
  renderDress();
}

function renderLayers() {
  $("layerHost").innerHTML = state.layers
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((layer) => {
      const image = state.images.get(layer.imageId)?.dataUrl || "";
      const width = Math.min(180, Math.max(52, layer.imageWidth / 3));
      return `<img class="dress-layer ${layer.id === state.selectedLayerId ? "selected" : ""}" data-layer-id="${
        layer.id
      }" src="${image}" alt="${escapeAttr(layer.name)}" style="${layerStyle(layer, width)}" />`;
    })
    .join("");
  [...$("layerHost").children].forEach((layerEl) => setupLayerPointer(layerEl));
}

function layerStyle(layer, width) {
  return [
    `left:${layer.x}%`,
    `top:${layer.y}%`,
    `width:${width}px`,
    `z-index:${layer.zIndex}`,
    `transform: translate(-50%, -50%) scale(${layer.scale}) rotate(${layer.rotation}deg)`,
  ].join(";");
}

function setupLayerPointer(layerEl) {
  let start = null;
  layerEl.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const layer = findLayer(layerEl.dataset.layerId);
    if (!layer) return;
    state.selectedLayerId = layer.id;
    pushUndo();
    const rect = $("stage").getBoundingClientRect();
    start = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, layerX: layer.x, layerY: layer.y, width: rect.width, height: rect.height };
    layerEl.setPointerCapture(event.pointerId);
    renderTransformPanel();
    document.querySelectorAll(".dress-layer").forEach((el) => el.classList.toggle("selected", el === layerEl));
  });
  layerEl.addEventListener("pointermove", (event) => {
    if (!start || event.pointerId !== start.pointerId) return;
    const layer = findLayer(layerEl.dataset.layerId);
    if (!layer) return;
    layer.x = clamp(start.layerX + ((event.clientX - start.x) / start.width) * 100, -20, 120);
    layer.y = clamp(start.layerY + ((event.clientY - start.y) / start.height) * 100, -20, 120);
    layerEl.style.left = `${layer.x}%`;
    layerEl.style.top = `${layer.y}%`;
  });
  layerEl.addEventListener("pointerup", () => {
    start = null;
  });
}

function renderTransformPanel() {
  const layer = findLayer(state.selectedLayerId);
  $("selectedLayerName").textContent = layer ? layer.name : "未选择衣物";
  $("selectedLayerHint").textContent = layer ? `${layer.category} · 可拖拽调整` : "点选已穿上的衣物后可调整";
  $("scaleRange").disabled = !layer;
  $("rotateRange").disabled = !layer;
  $("removeLayerBtn").disabled = !layer;
  if (layer) {
    $("scaleRange").value = layer.scale;
    $("rotateRange").value = layer.rotation;
  }
}

function updateSelectedTransform() {
  const layer = findLayer(state.selectedLayerId);
  if (!layer) return;
  layer.scale = Number($("scaleRange").value);
  layer.rotation = Number($("rotateRange").value);
  renderLayers();
}

function removeSelectedLayer() {
  if (!state.selectedLayerId) return;
  pushUndo();
  state.layers = state.layers.filter((layer) => layer.id !== state.selectedLayerId);
  state.selectedLayerId = null;
  renderDress();
}

function clearLayers() {
  if (!state.layers.length || !confirm("清空当前换装图层吗？")) return;
  pushUndo();
  state.layers = [];
  state.selectedLayerId = null;
  renderDress();
}

function pushUndo() {
  state.undoStack.push(JSON.stringify(state.layers));
  if (state.undoStack.length > 20) state.undoStack.shift();
}

function undoLayerChange() {
  const previous = state.undoStack.pop();
  if (!previous) return;
  state.layers = JSON.parse(previous);
  state.selectedLayerId = null;
  renderDress();
}

async function onMannequinImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const processed = await processImage(file, { displayMax: 1200, thumbMax: 360, forcePng: true });
  const image = { ...processed.display, id: uid(), kind: "mannequin" };
  await put("images", image);
  await put("settings", { id: "mannequinImageId", value: image.id });
  await refreshData();
  renderDress();
}

function openSaveOutfit() {
  if (!state.layers.length) {
    alert("请先选择至少一件衣物。");
    return;
  }
  $("outfitNameInput").value = state.editingOutfitId ? state.outfits.find((outfit) => outfit.id === state.editingOutfitId)?.name || "" : "";
  $("outfitNameDialog").showModal();
}

async function saveOutfit(event) {
  event.preventDefault();
  const name = normalizeName($("outfitNameInput").value) || "未命名搭配";
  const existing = state.outfits.find((outfit) => outfit.id === state.editingOutfitId);
  const preview = await makeOutfitPreview();
  await put("images", preview);
  const outfit = {
    id: existing?.id || uid(),
    name,
    mannequinImageId: state.mannequinImageId,
    layers: JSON.parse(JSON.stringify(state.layers)),
    previewImageId: preview.id,
    createdAt: existing?.createdAt || now(),
    updatedAt: now(),
  };
  if (existing?.previewImageId) await del("images", existing.previewImageId);
  await put("outfits", outfit);
  state.editingOutfitId = outfit.id;
  await refreshData();
  renderOutfits();
  $("outfitNameDialog").close();
  alert("搭配已保存。");
}

async function makeOutfitPreview() {
  const canvas = document.createElement("canvas");
  canvas.width = 420;
  canvas.height = 560;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fffaf4";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (state.mannequinImageId) {
    await drawContain(ctx, state.images.get(state.mannequinImageId)?.dataUrl, 0, 0, canvas.width, canvas.height);
  }
  const sorted = state.layers.slice().sort((a, b) => a.zIndex - b.zIndex);
  for (const layer of sorted) {
    const dataUrl = state.images.get(layer.imageId)?.dataUrl;
    if (!dataUrl) continue;
    const img = await loadImage(dataUrl);
    ctx.save();
    ctx.translate((layer.x / 100) * canvas.width, (layer.y / 100) * canvas.height);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    const baseWidth = Math.min(180, Math.max(52, layer.imageWidth / 3)) * layer.scale * 1.45;
    const ratio = img.height / img.width;
    ctx.drawImage(img, -baseWidth / 2, -(baseWidth * ratio) / 2, baseWidth, baseWidth * ratio);
    ctx.restore();
  }
  return { id: uid(), kind: "outfitPreview", mimeType: "image/png", width: canvas.width, height: canvas.height, dataUrl: canvas.toDataURL("image/png"), createdAt: now() };
}

async function drawContain(ctx, dataUrl, x, y, w, h) {
  if (!dataUrl) return;
  const img = await loadImage(dataUrl);
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function renderOutfits() {
  const query = $("outfitSearch").value.trim().toLowerCase();
  const outfits = state.outfits
    .filter((outfit) => {
      if (!query) return true;
      const layerNames = outfit.layers.map((layer) => layer.name).join(" ");
      return `${outfit.name} ${layerNames}`.toLowerCase().includes(query);
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  $("outfitsEmpty").classList.toggle("show", outfits.length === 0);
  $("outfitList").innerHTML = outfits
    .map((outfit) => {
      const image = state.images.get(outfit.previewImageId)?.dataUrl || "";
      const names = outfit.layers.map((layer) => layer.name).slice(0, 4).join(" / ");
      return `
        <article class="outfit-card" data-id="${outfit.id}">
          <img src="${image}" alt="${escapeAttr(outfit.name)}" />
          <div>
            <strong>${escapeHtml(outfit.name)}</strong>
            <span>${escapeHtml(names || "空搭配")}</span>
            <div class="outfit-actions">
              <button data-action="open" type="button">打开</button>
              <button data-action="rename" type="button">重命名</button>
              <button class="danger" data-action="delete" type="button">删除</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
  [...$("outfitList").querySelectorAll("button")].forEach((button) => {
    button.addEventListener("click", () => handleOutfitAction(button.closest(".outfit-card").dataset.id, button.dataset.action));
  });
}

async function handleOutfitAction(id, action) {
  const outfit = state.outfits.find((item) => item.id === id);
  if (!outfit) return;
  if (action === "open") {
    state.layers = JSON.parse(JSON.stringify(outfit.layers));
    state.mannequinImageId = outfit.mannequinImageId || state.mannequinImageId;
    state.editingOutfitId = outfit.id;
    if (state.mannequinImageId) await put("settings", { id: "mannequinImageId", value: state.mannequinImageId });
    setPage("dress");
    renderDress();
  }
  if (action === "rename") {
    const name = prompt("新的搭配名称", outfit.name);
    if (!name) return;
    await put("outfits", { ...outfit, name: normalizeName(name), updatedAt: now() });
    await refreshData();
    renderOutfits();
  }
  if (action === "delete" && confirm(`删除搭配「${outfit.name}」吗？`)) {
    await del("outfits", outfit.id);
    if (outfit.previewImageId) await del("images", outfit.previewImageId);
    await refreshData();
    renderOutfits();
  }
}

function renderLocations() {
  $("locationList").innerHTML = locationNames()
    .map(
      (name) => `
      <div class="location-row">
        <span>${escapeHtml(name)}</span>
        <button data-action="rename" data-name="${escapeAttr(name)}" type="button">重命名</button>
        <button class="danger" data-action="delete" data-name="${escapeAttr(name)}" type="button">删除</button>
      </div>`
    )
    .join("");
  [...$("locationList").querySelectorAll("button")].forEach((button) => {
    button.addEventListener("click", () => handleLocationAction(button.dataset.name, button.dataset.action));
  });
}

async function addLocation(event) {
  event.preventDefault();
  const name = normalizeName($("newLocationName").value);
  if (!name) return;
  await ensureLocation(name);
  $("newLocationName").value = "";
  await refreshData();
  renderLocations();
  renderCloset();
  renderLocationOptions();
}

async function handleLocationAction(name, action) {
  const location = state.locations.find((item) => item.name === name);
  if (!location) return;
  if (action === "rename") {
    const nextName = normalizeName(prompt("新的位置名称", name));
    if (!nextName || nextName === name) return;
    const updatedGarments = state.garments.filter((garment) => garment.locationName === name);
    await put("locations", { ...location, name: nextName, updatedAt: now() });
    for (const garment of updatedGarments) await put("garments", { ...garment, locationName: nextName, updatedAt: now() });
  }
  if (action === "delete") {
    const used = state.garments.some((garment) => garment.locationName === name);
    if (used) {
      alert("这个位置已经被衣物使用，请先修改相关衣物位置。");
      return;
    }
    if (!confirm(`删除位置「${name}」吗？`)) return;
    await del("locations", location.id);
  }
  await refreshData();
  renderLocations();
  renderAll();
}

async function ensureLocation(name) {
  const normalized = normalizeName(name);
  if (!normalized) return;
  const exists = state.locations.some((item) => item.name === normalized);
  if (!exists) await put("locations", { id: uid(), name: normalized, createdAt: now(), updatedAt: now() });
}

async function exportBackup() {
  await refreshData();
  const data = {
    app: "wardrobe-local",
    version: 1,
    exportedAt: now(),
    garments: state.garments,
    locations: state.locations,
    outfits: state.outfits,
    images: [...state.images.values()],
    settings: await getAll("settings"),
  };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `wardrobe-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!confirm("导入会覆盖当前本地数据，继续吗？")) return;
  const text = await file.text();
  const data = JSON.parse(text);
  await Promise.all(["garments", "locations", "outfits", "images", "settings"].map(clearStore));
  for (const item of data.garments || []) await put("garments", item);
  for (const item of data.locations || []) await put("locations", item);
  for (const item of data.outfits || []) await put("outfits", item);
  for (const item of data.images || []) await put("images", item);
  for (const item of data.settings || []) await put("settings", item);
  await refreshData();
  renderAll();
  alert("备份已导入。");
  event.target.value = "";
}

async function clearAllData() {
  if (!confirm("确定清空全部衣橱、图片和搭配吗？这个操作不能撤销。")) return;
  if (!confirm("请再次确认：真的清空全部数据？")) return;
  await Promise.all(["garments", "locations", "outfits", "images", "settings"].map(clearStore));
  state.layers = [];
  state.selectedLayerId = null;
  state.editingOutfitId = null;
  await refreshData();
  renderAll();
  $("settingsDialog").close();
}

async function processImage(file, options = {}) {
  const displayMax = options.displayMax || 900;
  const thumbMax = options.thumbMax || 320;
  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);
  const keepPng = options.forcePng || file.type.includes("png");
  const thumbnail = resizeImage(image, thumbMax, keepPng ? "image/png" : "image/jpeg", 0.78, "thumbnail");
  const display = resizeImage(image, displayMax, keepPng ? "image/png" : "image/jpeg", 0.86, "display");
  return { thumbnail, display };
}

function resizeImage(image, maxSide, mimeType, quality, kind) {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return { id: uid(), kind, mimeType, width, height, dataUrl: canvas.toDataURL(mimeType, quality), createdAt: now() };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function locationNames() {
  return [...new Set(state.locations.map((item) => item.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function findLayer(id) {
  return state.layers.find((layer) => layer.id === id);
}

function isAccessory(category) {
  return ["项链", "耳环", "手链", "戒指", "包"].includes(category);
}

function normalizeName(value) {
  return (value || "").trim().replace(/\s+/g, " ");
}

function now() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
