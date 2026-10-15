# 地图底图配置

桌面地图提供「影像」「路网」「混合」。默认影像适用于海上场景；混合视图保留主要道路、路名和地名，并随放大逐级显示细路。路网是浅灰、低饱和的 OpenMapTiles 矢量样式，参考 Positron 的视觉层级。地图与绘制器在切换、配置刷新和底图重试时保持原实例，业务坐标、引用 ID、版本和持久化记录不变。

## 默认数据源

| 视图数据 | 来源 | 覆盖和原生缩放 |
| --- | --- | --- |
| 影像 | [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | 全球 Web Mercator 范围，应用保守配置纬度 ±85°、z0–19；各地分辨率、拍摄时间和海面细节不同 |
| 路网与混合文字 | [OpenFreeMap planet](https://tiles.openfreemap.org/planet) | OpenMapTiles 3.16 兼容，全球 Mercator 范围，原生 z0–14；更大缩放沿用 z14 数据 |
| 文字字体 | [OpenFreeMap fonts](https://openfreemap.org/quick_start/) | `Noto Sans Regular`，包含中文所需字形 |

这些公开地址不需要应用密钥，浏览器直接请求。可用性取决于浏览器所在网络，尤其应在实际中国部署网络复验。默认源不是中澳自建高精度数据保证；本功能未建设瓦片生产线。参考项目 boat 的区域 tilemaker 包只覆盖其清单区域，接入时必须填写真实范围，不能标为全球。

右下角始终显示当前视图使用来源的署名链接；混合同时显示影像与矢量署名。影像的提供方说明为 Esri、Vantor、Earthstar Geographics 和 GIS User Community，实际使用仍应核对所选服务的许可、地域可用性和所需署名。它不是航海图、潮汐或实时海况数据。

## 混合视图的细路层级

混合视图在较小缩放保持影像清晰，放大后逐步显示已有矢量中的细路：`minor` 从 z13、`service` 从 z14、`track`/`path` 从 z15 出现。三类线宽在 z18 分别封顶为 1.8、1.4、1.0 像素，使用低透明度浅色细线与轻微深色描边；路径采用虚线。次要道路名称从 z15、服务道路名称从 z16 出现，启用文字避让和较大的重复间距，不叠加路径名称。业务道路、对象和标绘始终位于底图上方，路网视图的既有道路层级保持不变。

这些是显示层级，不是新增数据级别。默认矢量源原生最高 z14，在 z15 以上仍放大 z14 瓦片；样式可以揭示瓦片中已经存在、先前隐藏的细路，无法生成源里不存在的道路、提高坐标精度或保证每个区域的细路完整性。原生细节上限提示继续显示。

## 配置入口

复用 `LAB_CONTEXT_CONFIG` 指向的现有 JSON 文件，在顶层增加 `map`，与 `systems`、`scopes` 同级。未提供 `map` 时使用以上默认值。`GET /api/context/map-config` 返回公开地图配置；不要在地址里放服务端秘密、查询凭证或私有访问令牌。

```json
{
  "defaultView": "imagery",
  "imagery": {
    "providerId": "esri-world-imagery",
    "name": "Esri World Imagery",
    "tiles": ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    "tileSize": 256,
    "coordinateSystem": "wgs84",
    "projection": "web-mercator",
    "scheme": "xyz",
    "bounds": [-180, -85, 180, 85],
    "minZoom": 0,
    "maxZoom": 19,
    "attributions": [{
      "text": "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community",
      "url": "https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9"
    }]
  },
  "roads": {
    "providerId": "openfreemap",
    "name": "OpenFreeMap / OpenMapTiles",
    "url": "https://tiles.openfreemap.org/planet",
    "glyphs": "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    "coordinateSystem": "wgs84",
    "projection": "web-mercator",
    "scheme": "xyz",
    "bounds": [-180, -85.051129, 180, 85.051129],
    "minZoom": 0,
    "maxZoom": 14,
    "attributions": [
      {"text": "OpenFreeMap", "url": "https://openfreemap.org/"},
      {"text": "© OpenMapTiles", "url": "https://openmaptiles.org/"},
      {"text": "© OpenStreetMap contributors", "url": "https://www.openstreetmap.org/copyright"}
    ]
  }
}
```

上面的对象是 `map` 的值，不是完整业务查询配置。`defaultView` 可以是 `imagery`、`road`、`hybrid`。部署或场景配置只决定首次选择；配置刷新不会覆盖正在使用的视图。用户点击选择后，使用现有 API client 的 `storageKey('berserk.basemap-view', 'user-preference')` 写入 localStorage：测试席位按席位区分，正式用户按稳定 userId 区分，同一用户退出后重新登录仍保留选择，不同用户互不影响。只有这项非敏感视觉偏好选择稳定用户作用域；其他缓存与草稿仍使用原来的登录 viewId 作用域。存储不可用时仍可在当前地图中切换。

## 替换区域数据

- 影像可替换 `tiles`、`tileSize`、来源名称、范围、缩放和署名。路网可填写 TileJSON `url`，或者 1–4 个 `tiles` XYZ 模板，两者只能选一个；矢量必须兼容 OpenMapTiles 的 `landuse`、`park`、`water`、`waterway`、`building`、`transportation`、`transportation_name`、`place` 层。无需导入外部样式文件。
- `bounds` 是 `[西经度, 南纬度, 东经度, 北纬度]`，采用 WGS84，经度范围 −180～180、纬度不超过 Mercator ±85.051129°，不支持跨日期变更线的单个区域包；不能用四至框声明实际不存在的数据。海上瓦片覆盖需包含任务所需近海。
- 数据和业务坐标统一为 WGS84 经度在前。底图瓦片采用 EPSG:3857/Web Mercator、XYZ 行号。GCJ-02、BD-09、TMS 或其他投影会被配置校验拒绝；本功能不做隐式偏移或修改业务坐标。中国区域影像接入前必须确认实际坐标基准。
- `minZoom`/`maxZoom` 是数据源真实的原生缩放（整数 0～24）。低于最小级别会提示放大；超过最大级别继续放大已有数据并提示细节上限，不强制移动相机。显式配置覆盖 TileJSON 同名元数据，部署者应保持两者一致。
- 字形接口必须包含 `{fontstack}` 与 `{range}`，瓦片包含 `{z}`、`{x}`、`{y}`；地址必须是无用户名/密码的 HTTP(S)。页面为 HTTPS 时需使用 HTTPS 地址。来源服务器须允许浏览器跨域读取瓦片、TileJSON 和字形。
- 首版每个配置只有一组影像与路网来源。分别部署中国、澳大利亚区域源，或使用有真实覆盖的联合服务；没有自动按国家切换供应商的插件系统。

旧版 `{providerId, tiles, tileSize, attributionText, attributionUrl}` 地图配置仍可读取，映射为影像视图，并使用默认公开路网补充另外两种视图。旧栅格的实际内容不会被自动识别为影像，建议部署时迁移到新配置以提供准确的范围和缩放。

## 失败与验证

底图按需加载；快速切换仅修改可见性。错误归属当前底图源代次，旧请求不会覆盖重试结果。当前视野部分或全部超出配置覆盖时显示提示；瓦片失败与 15 秒加载超时提供「重试底图」，它只重建底图来源和样式层。慢请求在当前来源确认加载完成后自动清除超时提示；明确的瓦片错误保留到重试，不把失败请求结束当作成功。业务对象、选中态、可见性和未完成绘制继续保留。WebGL 不可用时仍保留图层与对象面板。

确定性测试使用本地栅格与 MVT 夹具，覆盖三种视图、来源隔离、视角/选择保持、偏好、覆盖提示、快速切换、失败重试和线/面续画。真实源验收需要单独在青岛与悉尼的城区、港口、近海检查，网络成功不能替代影像清晰度和坐标对齐判断。
