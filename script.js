'use strict';

/**
 * OptiDomain Professional Subsystem v2.3
 *
 * New in this version:
 *  ✦ Skeleton screen — shimmer placeholder rows before data arrives
 *  ✦ Copy button icon feedback — content_copy → check (600 ms)
 *  ✦ IP cell pulse feedback — ripple on click
 *  ✦ Intl.RelativeTimeFormat — "3 分钟前" appended to sync timestamp
 *  ✦ Robust CSV parser — handles RFC-4180 quoted fields & CRLF
 *  ✦ IS_DEV extended — localhost OR ?debug=1 URL param
 *  ✦ Service Worker registration
 *  ✦ data-label on every td (powers mobile card layout via CSS)
 *  ✦ Better error messages (actionable copy)
 */

// ─── Environment ─────────────────────────────────────────────────────────────
const IS_DEV = (() => {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return true;
    return new URLSearchParams(location.search).get('debug') === '1';
})();

const Logger = {
    log:   (...a) => IS_DEV && console.log('%c[OptiDomain]', 'color:#F6821F;font-weight:bold', ...a),
    warn:  (...a) => IS_DEV && console.warn('%c[OptiDomain]', 'color:#B45309;font-weight:bold', ...a),
    error: (...a) => {
        if (IS_DEV) console.error('%c[OptiDomain]', 'color:#C62828;font-weight:bold', ...a);
        // Production: pipe to monitoring endpoint here if needed
    },
};

// ─── Central Configuration ────────────────────────────────────────────────────
// domainSuffix is injected via <meta name="routing-domain"> for easy reconfiguration
// without touching JS source. Falls back to the hardcoded value if meta is absent.
const CONFIG = Object.freeze({
    domainSuffix:   document.querySelector('meta[name="routing-domain"]')?.content
                    || 'djx-ybelove.pp.ua',
    apiEndpoint:    'optimized_cf_ips.csv',
    toastDuration:  2800,
    toastFadeMs:    350,    // must match CSS transition duration
    itDogPrefix:    'https://www.itdog.cn/tcping/',
    wildcardChars:  'abcdefghijklmnopqrstuvwxyz0123456789',
    wildcardMaxLen: 5,
    latencyWarnMs:  150,
    skeletonRows:   5,  // skeleton row count shown before data loads
});

// Column definitions — single source of truth for headers & mobile labels
const COLUMNS = ['Line Channel', 'IP', 'Avg Latency', 'Loss Rate', 'Colo Edge'];

// ─── Intl Formatters ──────────────────────────────────────────────────────────
const FMT = {
    number: new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }),
    datetime: new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }),
    relative: new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }),
};

/** Returns { text: "2026-04-06 00:43（3 分钟前）", level: "fresh"|"warn"|"stale" } */
function formatSyncTime(raw) {
    const ts = new Date(raw.replace(' ', 'T'));
    if (isNaN(ts)) return { text: raw, level: 'fresh' };

    const abs = FMT.datetime.format(ts);
    const diffSec = (Date.now() - ts) / 1000;
    let rel;
    const abs_ = Math.abs(diffSec);
    if (abs_ < 60)       rel = FMT.relative.format(-Math.round(diffSec),        'second');
    else if (abs_ < 3600)  rel = FMT.relative.format(-Math.round(diffSec / 60),   'minute');
    else if (abs_ < 86400) rel = FMT.relative.format(-Math.round(diffSec / 3600), 'hour');
    else                   rel = FMT.relative.format(-Math.round(diffSec / 86400), 'day');

    // Freshness level
    const level = diffSec < 3600 ? 'fresh' : diffSec < 86400 ? 'warn' : 'stale';
    return { text: `${abs}（${rel}）`, level };
}

// ─── CSV Parser (RFC-4180 compliant) ─────────────────────────────────────────
/**
 * Parses a single CSV row respecting double-quoted fields.
 * e.g.  `CM,"104.18,46.37",73.74,0`  → ['CM', '104.18,46.37', '73.74', '0']
 */
function parseCSVRow(row) {
    const fields = [];
    let cur = '';
    let inQ  = false;
    for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '"') {
            if (inQ && row[i + 1] === '"') { cur += '"'; i++; }  // escaped quote
            else inQ = !inQ;
        } else if (ch === ',' && !inQ) {
            fields.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    fields.push(cur);
    return fields;
}

// ─── UI Controller ────────────────────────────────────────────────────────────
class UIController {
    static #toastTimer  = null;
    static #toast       = null;
    static #toastQueue  = [];      // message queue to prevent overlap
    static #toastBusy   = false;   // true while a toast is visible

    static init() {
        this.#toast = document.getElementById('toast');
    }

    static showToast(msg) {
        // 防抖：如果队列中已有同样的消息，或是当前正显示同样的消息，则忽略
        if (this.#toastBusy && this.#toast.textContent === msg) return;
        if (this.#toastQueue.includes(msg)) return;
        
        this.#toastQueue.push(msg);
        if (!this.#toastBusy) this.#drainToastQueue();
    }

    static #drainToastQueue() {
        if (!this.#toastQueue.length) { this.#toastBusy = false; return; }
        if (!this.#toast) return;
        this.#toastBusy = true;
        
        // 如果即将显示，动态赋予 will-change 来实现无感知硬件加速
        this.#toast.style.willChange = 'transform, opacity';
        
        const msg = this.#toastQueue.shift();
        this.#toast.textContent = msg;
        this.#toast.classList.add('show');
        
        if (this.#toastTimer) clearTimeout(this.#toastTimer);
        this.#toastTimer = setTimeout(() => {
            this.#toast.classList.remove('show');
            setTimeout(() => {
                // 动画播毕移除 will-change 防止显存挂载
                this.#toast.style.willChange = 'auto';
                this.#drainToastQueue();
            }, CONFIG.toastFadeMs);
        }, CONFIG.toastDuration);
    }

    /** Clipboard write with legacy execCommand fallback */
    static async secureCopy(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = Object.assign(document.createElement('textarea'), {
                    value: text,
                    style: 'position:fixed;opacity:0;pointer-events:none',
                });
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            this.showToast(`✓ 已复制到剪贴板：${text}`);
        } catch (err) {
            Logger.error('Clipboard write failed', err);
            this.showToast('⚠ 剪贴板写入失败，请手动选中复制');
        }
    }

    /**
     * Temporarily swap a button's icon to "check" for visual confirmation.
     * Works on <button> and on role=button <td> elements.
     */
    static flashSuccess(el) {
        const icon = el.querySelector?.('.material-symbols-outlined');
        if (icon) {
            const orig = icon.textContent;
            icon.textContent = 'check';
            el.classList.add('action-success');
            setTimeout(() => {
                icon.textContent = orig;
                el.classList.remove('action-success');
            }, 600);
        } else {
            // IP cell — add a pulse class instead
            el.classList.add('ip-pulse');
            setTimeout(() => el.classList.remove('ip-pulse'), 500);
        }
    }

    static jumpToProbe(domain) {
        window.open(`${CONFIG.itDogPrefix}${domain}:443`, '_blank', 'noopener,noreferrer');
    }

    /** Haptic feedback on mobile: 20ms vibration confirms action */
    static hapticFeedback() {
        if (navigator.vibrate) navigator.vibrate(20);
    }

    static setRetryVisible(visible) {
        const block = document.getElementById('retryBlock');
        if (block) block.hidden = !visible;
    }
}

// ─── Network Manager ──────────────────────────────────────────────────────────
class NetworkManager {
    static #activeController = null;

    static getWildcard() {
        const ch  = CONFIG.wildcardChars;
        const len = Math.floor(Math.random() * CONFIG.wildcardMaxLen) + 1;
        let prefix = '';
        for (let i = 0; i < len; i++) prefix += ch[Math.floor(Math.random() * ch.length)];
        return `${prefix}.cdn.${CONFIG.domainSuffix}`;
    }

    // ── Skeleton screen ───────────────────────────────────────────────────────
    static renderSkeleton() {
        const tbody = document.getElementById('tableBody');
        const frag  = document.createDocumentFragment();
        // Vary widths per column for a more organic feel
        const widths = [
            ['36px',  '36px',  '36px',  '36px',  '36px'],   // badge-like
            ['120px', '130px', '115px', '125px', '120px'],   // IP-like
            ['64px',  '60px',  '68px',  '62px',  '66px'],    // ms value
            ['40px',  '44px',  '42px',  '40px',  '46px'],    // %
            ['72px',  '72px',  '72px',  '72px',  '72px'],    // button
        ];
        for (let r = 0; r < CONFIG.skeletonRows; r++) {
            const tr = document.createElement('tr');
            tr.className = 'skeleton-row';
            tr.setAttribute('aria-hidden', 'true');
            for (let c = 0; c < 5; c++) {
                const td = document.createElement('td');
                td.dataset.label = COLUMNS[c];
                const bone = document.createElement('span');
                bone.className = 'skeleton-bone';
                bone.style.width = widths[c][r] ?? widths[c][0];
                td.appendChild(bone);
                tr.appendChild(td);
            }
            frag.appendChild(tr);
        }
        tbody.replaceChildren(frag);
    }

    // ── Data renderer ─────────────────────────────────────────────────────────
    static loadDataToSandbox(csvText) {
        const tbody   = document.getElementById('tableBody');
        const syncLbl = document.getElementById('lastSyncTxt');

        // Normalise: strip BOM, unify line endings
        const lines = csvText.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
        if (lines.length < 2) throw new Error('CSV payload malformed — too few lines.');

        let lastRunTime = '';
        let dataStart   = 1;

        if (lines[0].startsWith('## ExecutionTime:')) {
            lastRunTime = lines[0].slice(17).trim();
            dataStart   = 2;
        }

        const dataRows = lines.slice(dataStart).filter(Boolean);
        if (!dataRows.length) throw new Error('CSV data section is empty.');

        const frag = document.createDocumentFragment();
        let rowIndex = 0;

        for (const row of dataRows) {
            // RFC-4180 compliant parse
            const cols = parseCSVRow(row);
            if (cols.length < 4) {
                Logger.warn('Skipping malformed row:', row);
                continue;
            }

            const [lineRaw, ipRaw, latRaw, lossRaw] = cols.map(c => c.trim());
            const tr = document.createElement('tr');
            // Stagger fade-in: each row enters slightly after the previous
            tr.className = 'row-enter';
            tr.style.animationDelay = `${rowIndex * 40}ms`;
            rowIndex++;

            /** XSS-safe cell */
            const cell = (text, mono = false) => {
                const td = document.createElement('td');
                td.textContent = text;
                if (mono) td.classList.add('code-font');
                return td;
            };

            // ── Col 0: Line Channel badge ──
            const lineCell = cell('');
            lineCell.dataset.label = COLUMNS[0];
            const badge = document.createElement('span');
            badge.textContent = lineRaw;
            badge.className = 'table-badge';
            badge.dataset.line = { CM: 'cm', CT: 'ct', CU: 'cu' }[lineRaw] ?? 'avg';
            lineCell.appendChild(badge);
            tr.appendChild(lineCell);

            // ── Col 1: IP (clickable copy) ──
            const ipCell = cell(ipRaw, true);
            ipCell.dataset.label  = COLUMNS[1];
            ipCell.classList.add('ip-clickable');
            ipCell.dataset.action = 'copyIP';
            ipCell.dataset.target = ipRaw;
            ipCell.setAttribute('role', 'button');
            ipCell.setAttribute('tabindex', '0');
            ipCell.setAttribute('aria-label', `复制 IP 地址 ${ipRaw}`);
            ipCell.title = '点击复制此节点 IP';
            tr.appendChild(ipCell);

            // ── Col 2: Avg Latency ──
            const latMs   = parseFloat(latRaw) || 0;
            const latCell = cell(`${FMT.number.format(latMs)} ms`);
            latCell.dataset.label = COLUMNS[2];
            latCell.className     = latMs > CONFIG.latencyWarnMs ? 'lat-high' : 'lat-ok';
            tr.appendChild(latCell);

            // ── Col 3: Loss Rate ──
            const lossCell = cell(`${FMT.number.format(parseFloat(lossRaw) || 0)}%`);
            lossCell.dataset.label = COLUMNS[3];
            tr.appendChild(lossCell);

            // ── Col 4: Colo Edge (jump button — generated client-side) ──
            const coloCell = document.createElement('td');
            coloCell.dataset.label = COLUMNS[4];
            const btn = document.createElement('button');
            btn.className       = 'md-btn btn-tonal colo-btn';
            btn.dataset.action  = 'colo';
            btn.dataset.target  = ipRaw;
            btn.setAttribute('aria-label', `查询节点 ${ipRaw} 的 Colo 边缘机房`);
            btn.title = '跳转并查询 CloudFlare 边缘 Colo';
            const ico = document.createElement('span');
            ico.className = 'material-symbols-outlined';
            ico.setAttribute('aria-hidden', 'true');
            ico.textContent = 'exit_to_app';
            btn.append(ico, document.createTextNode('跳转获取'));
            coloCell.appendChild(btn);
            tr.appendChild(coloCell);

            frag.appendChild(tr);
        }

        // Single-paint swap — no layout thrash
        tbody.replaceChildren(frag);

        // ── Sync timestamp with relative time + freshness color ──
        if (lastRunTime && syncLbl) {
            const { text, level } = formatSyncTime(lastRunTime);
            const mark = document.createElement('span');
            mark.className   = `code-font sync-time sync-${level}`;
            mark.textContent = text;
            syncLbl.replaceChildren(document.createTextNode('Last sync: '), mark);
            // Apply freshness color to the label itself
            syncLbl.classList.remove('sync-fresh', 'sync-warn', 'sync-stale');
            syncLbl.classList.add(`sync-${level}`);
        } else if (syncLbl && !lastRunTime) {
            // Bug Fix: If no timestamp header exists but data loaded fine, don't get stuck on "Pulling..."
            syncLbl.textContent = '数据已同步（未包含时间戳）';
            syncLbl.classList.remove('sync-warn', 'sync-stale');
            syncLbl.classList.add('sync-fresh');
        }
    }

    // ── Fetch with AbortController ────────────────────────────────────────────
    static async fetchEngineNodes() {
        UIController.setRetryVisible(false);
        this.renderSkeleton();   // show shimmer immediately

        if (this.#activeController) {
            this.#activeController.abort();
            Logger.log('Aborted previous in-flight request.');
        }
        this.#activeController = new AbortController();
        const { signal } = this.#activeController;

        try {
            const res = await fetch(
                `${CONFIG.apiEndpoint}?_cb=${Date.now()}`,
                { signal, cache: 'no-store' }
            );
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
            const text = await res.text();
            this.loadDataToSandbox(text);
            Logger.log('Node data loaded successfully.');
        } catch (err) {
            if (err.name === 'AbortError') {
                Logger.log('Fetch intentionally aborted.');
                return;
            }
            Logger.error('fetchEngineNodes failed:', err);
            UIController.showToast('无法连接到数据源，请检查网络后重试');
            // 细化触觉反馈：网络失败发出急促的双短震预警
            if (navigator.vibrate) navigator.vibrate([20, 50, 20]);

            const tbody = document.getElementById('tableBody');
            const tr = document.createElement('tr');
            const td = Object.assign(document.createElement('td'), {
                colSpan:   5,
                className: 'empty-state',
                textContent: `⚠ 数据获取失败 — ${err.message}。请检查网络连接或稍后重试。`,
            });
            tr.appendChild(td);
            tbody.replaceChildren(tr);

            const syncLbl = document.getElementById('lastSyncTxt');
            if (syncLbl) syncLbl.textContent = '上游数据源暂时不可用';
            UIController.setRetryVisible(true);
        } finally {
            this.#activeController = null;
        }
    }
}

// ─── Event Handler ────────────────────────────────────────────────────────────
function handleAction(e) {
    // Support both click and keyboard (Enter / Space) on role=button elements
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    if (e.type === 'keydown') e.preventDefault(); // prevent page scroll on Space

    const el     = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action ?? '';
    const target = el.dataset.target ?? '';

    switch (action) {
        case 'copyIP':
            UIController.flashSuccess(el);
            UIController.hapticFeedback();
            UIController.secureCopy(target);
            break;

        case 'colo':
            window.open(`http://${target}/cdn-cgi/trace`, '_blank', 'noopener,noreferrer');
            break;

        case 'retryFetch': {
            const orig = el.innerHTML;
            el.textContent = '重新连接中...';
            el.disabled    = true;
            NetworkManager.fetchEngineNodes().finally(() => {
                el.innerHTML  = orig;
                el.disabled   = false;
            });
            break;
        }

        case 'reload':
            location.reload();
            break;

        case 'copy':
        case 'test': {
            let uri = '';
            if      (target === 'wildcard') uri = NetworkManager.getWildcard();
            else if (target === 'cdn')      uri = `cdn.${CONFIG.domainSuffix}`;
            else                            uri = `${target}.${CONFIG.domainSuffix}`;

            if (action === 'copy') {
                UIController.flashSuccess(el);
                UIController.hapticFeedback();   // 移动端震动确认
                UIController.secureCopy(uri);
            } else {
                UIController.hapticFeedback();   // 移动端震动确认
                UIController.jumpToProbe(uri);
            }
            break;
        }

        default:
            Logger.warn('Unhandled data-action:', action);
    }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    UIController.init();
    NetworkManager.fetchEngineNodes();

    document.addEventListener('click',   handleAction);
    document.addEventListener('keydown', handleAction);

    // ── Image error: show friendly placeholder if TCPing snapshot fails ──
    const img        = document.getElementById('tcpingImg');
    const imgErrorEl = document.getElementById('tcpingErrorPlaceholder');
    if (img && imgErrorEl) {
        img.addEventListener('error', () => {
            img.hidden       = true;
            imgErrorEl.hidden = false;
            // Build placeholder with CSP-compliant event delegation (no onclick=)
            imgErrorEl.insertAdjacentHTML('beforeend', [
                '<span class="material-symbols-outlined err-icon">image_not_supported</span>',
                '<strong>快照暂时无法加载</strong>',
                '<span>TCPing 截图资源不可用，请检查本地文件是否存在</span>',
                '<button class="md-btn btn-tonal" data-action="reload" style="margin-top:4px">',
                '  <span class="material-symbols-outlined" aria-hidden="true">refresh</span>刷新页面',
                '</button>',
            ].join(''));
        }, { once: true });
    }
});

// ─── Service Worker Registration ─────────────────────────────────────────────
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(reg  => Logger.log('Service Worker registered. Scope:', reg.scope))
            .catch(err => Logger.error('Service Worker registration failed:', err));
    });
}
