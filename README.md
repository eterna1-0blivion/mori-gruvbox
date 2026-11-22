# Mori Gruvbox

Gruvbox с нейтральным интерфейсом: подсветка кода остаётся Gruvbox, а панели,
вкладки, кнопки, бейджи и чат становятся серыми — без цветных акцентов, в духе
встроенной темы Dark Modern.

Состоит из двух независимых частей:

| Часть | Что делает | Откат |
|---|---|---|
| **Тема VS Code** | расширение-тема `Mori Gruvbox Dark Hard` | `install-vscode-theme.ps1 -Uninstall` |
| **Тема Mozg** | патч интерфейса расширения [Mozg](https://github.com/MORI-AI-PLATFORM/mori-code-releases) (`mori-ai.mori-code`) | `install-mozg-theme.ps1 -Revert` |

## Зачем две части

Расширение Mozg рисует интерфейс в webview и **не наследует тему VS Code** —
его CSS задаёт собственную палитру (`--mori-accent: #ff6a1a` и другие). Поэтому
темы VS Code недостаточно: чтобы убрать оранжевый акцент из чата, нужен
отдельный патч его CSS. Обратное тоже верно: патч Mozg никак не влияет на
остальной редактор.

## Установка

```powershell
git clone https://github.com/vl4dislaw/mori-gruvbox.git
cd mori-gruvbox
.\scripts\install.ps1
```

Скрипт задаёт **два отдельных вопроса** — про тему VS Code и про тему Mozg.
Можно согласиться на любую часть или отказаться от обеих.

Только одна часть:

```powershell
.\scripts\install.ps1 -Only vscode     # только тема редактора
.\scripts\install.ps1 -Only mozg       # только интерфейс Mozg
```

После установки перезагрузите окно (`Ctrl+Shift+R`) и выберите тему:
`Ctrl+K Ctrl+T` → **Mori Gruvbox Dark Hard**.

Сделать тему активной сразу:

```powershell
.\scripts\install.ps1 -Yes -SetActive
```

## Требования

- **Windows** — скрипты написаны на PowerShell (5.1 и 7+).
- **Node.js 18+** — только для сборки JSON темы и упаковки `.vsix`.
- **VS Code 1.80+** — тема; Mozg ставится отдельно.

### Если PowerShell блокирует запуск

При политике `RemoteSigned` скрипты, скачанные как ZIP с GitHub, будут
заблокированы (метка «из интернета»). Варианты:

```powershell
# разово, без изменения системных настроек
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1

# либо снять блокировку с файлов проекта
Get-ChildItem -Recurse | Unblock-File
```

## После установки

Тема VS Code и патч Mozg независимы, но вместе дают цельный вид.

Если в `settings.json` остался прежний блок `"[Gruvbox Dark Hard]"`
с `workbench.colorCustomizations`, его можно удалить: те же цвета теперь
внутри темы, а блок действует только на старую Gruvbox.

## Что именно меняется

Подсветка синтаксиса (`tokenColors`, `semanticTokenColors`) берётся из Gruvbox
Dark Hard без изменений. Переопределяются только цвета UI — 84 ключа:
поверхности, границы, бейджи, кнопки, прогресс, ссылки, выделение, а также
ключи `chat.*` (пузыри сообщений, аватар, блок запроса, рамка ввода).

| Где | Gruvbox | Mori Gruvbox |
|---|---|---|
| `sideBar.background` | `#1d2021` | `#181818` |
| `editor.background` | `#1d2021` | `#1f1f1f` |
| `badge.background` | `#b16286` (розовый) | `#3c3c3c` |
| `button.background` | `#458588` (синий) | `#3a3a3a` |
| `progressBar.background` | `#689d6a` (зелёный) | `#5a5a5a` |
| `textLink.foreground` | `#83a598` (аква) | `#9db8c4` |
| `chat.slashCommandBackground` | — | `#ffffff14` |
| `chat.requestBubbleBackground` | — | `#ffffff0d` |

Полный список — в `src/overrides.json`. Изменить палитру можно там же, затем
`npm run build`.

## Сборка

```powershell
npm run build     # upstream + overrides -> themes/mori-gruvbox-dark-hard.json
npm run check     # проверить, что тема в репозитории актуальна (для CI)
npm run package   # собрать .vsix
```

## Структура

```
upstream/   оригинальная тема Gruvbox Dark Hard (MIT, © 2017 JD)
src/        overrides.json — наш слой цветов
themes/     собранная тема (генерируется, но коммитится)
mozg/       mori-neutral.css — блок переопределений для webview Mozg
scripts/    build-theme.mjs, make-icon.ps1, install*.ps1
assets/     icon.png
```

## Откат

```powershell
.\scripts\install-mozg-theme.ps1 -Revert        # вернуть CSS Mozg
.\scripts\install-vscode-theme.ps1 -Uninstall   # удалить тему
```

Проверить состояние патча Mozg (полезно после обновления расширения):

```powershell
.\scripts\install-mozg-theme.ps1 -Status
```

## Ограничения и оговорки

- **Патч Mozg живёт до обновления расширения.** Апдейт переустанавливает
  `index.css` и затирает блок. После обновления запустите скрипт снова.
- Патч — это правка собранного CSS, а не исходников. Если авторы Mozg
  переименуют переменные, скрипт обнаружит это по отсутствию `--mori-accent`
  и откажется патчить, чтобы не испортить файл.
- **Неофициальный проект.** Не связан с Mozg AI / mori-ai и не одобрен ими.
  «Gruvbox» — палитра Pavel Pertsev (morhetz). Атрибуция — в [NOTICE](NOTICE).
- Проект проверялся на VS Code 1.147.0 (Windows). На других версиях ключи
  `chat.*` могут различаться: неизвестные ключи VS Code игнорирует, но и
  эффекта не дадут.

## Лицензия

MIT. Тема Gruvbox — MIT, © 2017 JD; палитра Gruvbox — MIT, © Pavel Pertsev.
Подробности в [LICENSE](LICENSE) и [NOTICE](NOTICE).
