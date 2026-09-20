# AppDock 设计稿

来源：OpenDesign 项目 `appdock-design`（Local Codex / artifacts-builder）  
迁移日期：2026-09-20

## 文件

| 文件 | 说明 |
|------|------|
| `index.html` | 可交互 Hash SPA 原型（下载站 + 管理后台） |
| `DESIGN.md` | 色板、字体、词标、关键组件约定 |

## 本地预览

用浏览器直接打开 `index.html`，或在本目录起静态服务：

```bash
npx --yes serve .
```

示意账号：管理端任意非空密码即可登录。

| 区域 | 路径 |
|------|------|
| 下载站首页 | `#/` |
| 应用详情 | `#/a/moonnotes` · `#/a/forgedesk`（口令）· `#/a/pixelsync`（登录） |
| 指定版本 | `#/a/moonnotes/v/v2.4.0` |
| 管理端 | `#/admin` |
| 空状态 | `#/forbidden` |

## 与开发的关系

实现 Vue3 前端时以本目录视觉与信息架构为准；接口与业务规则见 `docs/PRD.md`。
