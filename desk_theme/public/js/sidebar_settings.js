/* ===============================
   GLOBAL STATE
================================= */

window.currentActiveRoute = '';
window.expandedParents = new Set();
window.sidebarSearchTerm = '';

/* ===============================
   INIT EXPANDED STATE
================================= */

(function () {
    try {
        const saved = localStorage.getItem('expandedSidebarParents');
        if (saved) {
            window.expandedParents = new Set(JSON.parse(saved));
        }
    } catch (e) {
        window.expandedParents = new Set();
    }
})();

/* ===============================
   SAFE HELPERS
================================= */

function safe(str) {
    return String(str || '').replace(/['"]/g, '');
}

function getCurrentRouteString() {
    try {
        const r = frappe.get_route();
        return Array.isArray(r) ? r.join('/') : '';
    } catch {
        return '';
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/* ===============================
   BUILD SIDEBAR HTML
================================= */

async function build_sidebar_html(items, searchTerm = '') {

    if (!Array.isArray(items)) {
        return `<div class="sidebar-error">Invalid Sidebar Data</div>`;
    }

    const parents = {};
    const sorted = [...items].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    sorted.forEach(item => {
        if (!item.parent1) {
            parents[item.label] = { ...item, children: [] };
        }
    });

    sorted.forEach(item => {
        if (item.parent1 && parents[item.parent1]) {
            parents[item.parent1].children.push(item);
        }
    });

    // Filter based on search term
    const searchLower = searchTerm.toLowerCase();
    const filteredParents = {};

    Object.entries(parents).forEach(([key, parent]) => {
        const parentMatch = parent.label.toLowerCase().includes(searchLower);
        const filteredChildren = parent.children.filter(child => 
            child.label.toLowerCase().includes(searchLower)
        );

        if (parentMatch || filteredChildren.length > 0 || 
            (parent.url && parent.label.toLowerCase().includes(searchLower))) {
            filteredParents[key] = {
                ...parent,
                children: parentMatch ? parent.children : filteredChildren,
                matched: true
            };
        }
    });

    let html = `<div class="sidebar-content">`;

    if (Object.keys(filteredParents).length === 0) {
        html += `
            <div class="sidebar-no-results">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <p>No results found</p>
                <span>Try different keywords</span>
            </div>
        `;
    } else {
        Object.values(filteredParents).forEach(parent => {
            const parentKey = safe(parent.label);
            const isExpanded = window.expandedParents.has(parentKey) || searchTerm.length > 0;

            html += `
                <div class="section ${parent.matched ? 'section-highlight' : ''}" data-parent="${parentKey}">
                    <div class="section-header" data-parent="${parentKey}">
                        <span class="section-label">${parent.label}</span>
                        <svg class="section-chevron ${isExpanded ? 'expanded' : ''}" 
                             width="16" height="16" viewBox="0 0 24 24" fill="none" 
                             stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>

                    <ul class="menu-list ${isExpanded ? 'expanded' : 'collapsed'}">
            `;

            if (parent.children.length) {
                parent.children.forEach(child => {
                    const url = safe(child.url);
                    const isActive = window.currentActiveRoute === url;

                    html += `
                        <li class="menu-item ${isActive ? 'active' : ''}" 
                            data-url="${url}">
                            <span class="menu-label">${child.label}</span>
                        </li>
                    `;
                });
            } else if (parent.url) {
                const url = safe(parent.url);
                const isActive = window.currentActiveRoute === url;

                html += `
                    <li class="menu-item ${isActive ? 'active' : ''}" 
                        data-url="${url}">
                        <span class="menu-label">${parent.label}</span>
                    </li>
                `;
            }

            html += `</ul></div>`;
        });
    }

    html += `</div>`;

    return html;
}

/* ===============================
   ACTIVE ROUTE
================================= */

window.setActiveRoute = function (route) {
    if (!route) return;
    window.currentActiveRoute = route;

    document.querySelectorAll('.menu-item')
        .forEach(el => el.classList.remove('active'));

    const active = document.querySelector(`.menu-item[data-url="${route}"]`);
    if (active) {
        active.classList.add('active');
        
        // Auto-expand parent section of active item
        const parentSection = active.closest('.section');
        if (parentSection) {
            const parentKey = parentSection.dataset.parent;
            if (!window.expandedParents.has(parentKey)) {
                window.toggleParent(parentKey, true);
            }
        }
    }

    localStorage.setItem('activeSidebarRoute', route);
};

/* ===============================
   TOGGLE PARENT
================================= */

window.toggleParent = function (parentKey, skipAnimation = false) {
    if (!parentKey) return;

    const section = document.querySelector(`.section[data-parent="${parentKey}"]`);
    if (!section) return;

    const list = section.querySelector('.menu-list');
    const chevron = section.querySelector('.section-chevron');

    if (window.expandedParents.has(parentKey)) {
        window.expandedParents.delete(parentKey);
        list.classList.remove('expanded');
        list.classList.add('collapsed');
        if (chevron) chevron.classList.remove('expanded');
    } else {
        window.expandedParents.add(parentKey);
        list.classList.remove('collapsed');
        list.classList.add('expanded');
        if (chevron) chevron.classList.add('expanded');
    }

    localStorage.setItem(
        'expandedSidebarParents',
        JSON.stringify([...window.expandedParents])
    );
};

/* ===============================
   SEARCH HANDLER
================================= */

function handleSidebarSearch(e) {
    const searchTerm = e.target.value;
    window.sidebarSearchTerm = searchTerm;
    
    const sidebar = document.querySelector('.custom-sidebar');
    if (!sidebar) return;

    // Show loading state
    sidebar.classList.add('searching');

    // Debounced search
    debouncedSearch(searchTerm);
}

const debouncedSearch = debounce(async (searchTerm) => {
    try {
        const res = await frappe.call({
            method: "desk_theme.public.py.sidebar_settings.get_sidebar_items"
        });

        const items = res.message || [];
        const sidebar = document.querySelector('.custom-sidebar');
        if (!sidebar) return;

        const contentDiv = sidebar.querySelector('.sidebar-content-wrapper');
        if (contentDiv) {
            contentDiv.innerHTML = await build_sidebar_html(items, searchTerm);
        }

        bindSidebarEvents();
        
        if (window.currentActiveRoute) {
            window.setActiveRoute(window.currentActiveRoute);
        }

        sidebar.classList.remove('searching');
    } catch (e) {
        console.error('Search failed:', e);
        sidebar.classList.remove('searching');
    }
}, 300);

/* ===============================
   EVENT BINDING
================================= */

function bindSidebarEvents() {
    // Parent toggle
    document.querySelectorAll('.section-header')
        .forEach(el => {
            el.onclick = function (e) {
                e.stopPropagation();
                window.toggleParent(this.dataset.parent);
            };
        });

    // Menu click
    document.querySelectorAll('.menu-item')
        .forEach(el => {
            el.onclick = function (e) {
                e.stopPropagation();
                const url = this.dataset.url;
                window.setActiveRoute(url);
                frappe.set_route(url);
            };
        });

}

/* ===============================
   INJECT SIDEBAR
================================= */

async function inject_custom_sidebar() {
    const container = document.querySelector(".body-sidebar-container");
    if (!container) return;

    let sidebar = container.querySelector(".custom-sidebar");

    if (!sidebar) {
        sidebar = document.createElement("div");
        sidebar.className = "custom-sidebar";
        container.prepend(sidebar);
    }

    try {
        const storedRoute = localStorage.getItem('activeSidebarRoute');
        window.currentActiveRoute = storedRoute || getCurrentRouteString();

        const res = await frappe.call({
            method: "desk_theme.public.py.sidebar_settings.get_sidebar_items"
        });

        const items = res.message || [];

        // Get user initials for avatar
        const userName = frappe.session?.user || 'Guest';
        const userInitials = userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0,2) || 'G';

        sidebar.innerHTML = `
            <div class="sidebar-navbar">
                <div class="navbar-title">
                    <span>Next Edge Software</span>
                </div>
            </div>
            <div class="sidebar-content-wrapper">
                ${await build_sidebar_html(items, window.sidebarSearchTerm)}
            </div>
            <div class="sidebar-footer">
                <div class="footer-item user-info">
                    <div class="user-avatar" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white;">
                        ${userInitials}
                    </div>
                    <div class="user-details">
                        <span class="user-name">${userName}</span>
                        <span class="user-role">${frappe.boot?.user?.roles?.[0] || 'User'}</span>
                    </div>
                </div>
            </div>
        `;

        bindSidebarEvents();

        if (window.currentActiveRoute) {
            window.setActiveRoute(window.currentActiveRoute);
        }

    } catch (e) {
        sidebar.innerHTML = `
            <div class="sidebar-error">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <circle cx="12" cy="16" r="0.5" fill="currentColor"></circle>
                </svg>
                <p>Failed to load sidebar</p>
                <button onclick="window.inject_custom_sidebar()">Retry</button>
            </div>
        `;
    }
}

window.inject_custom_sidebar = inject_custom_sidebar;

/* ===============================
   FRAPPE READY
================================= */

frappe.after_ajax(() => {
    inject_custom_sidebar();
});

frappe.router.on("change", () => {
    setTimeout(() => inject_custom_sidebar(), 50);
});

/* ===============================
   STYLES
================================= */

const styles = `
.body-sidebar {
    display: none !important;
}

.body-sidebar-container {
  width: fit-content !important;
}

/* Custom Sidebar */
.custom-sidebar {
    width: 300px;
    height: 100vh;
    border-right: 1px solid rgba(226, 232, 240, 0.9);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    position: relative;
    box-shadow: 4px 0 20px rgba(0, 0, 0, 0.03);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    transition: all 0.3s ease;
}

/* Header - More colorful and stable */


/* Search - Enhanced */
.sidebar-navbar {
    padding: 16px 16px 12px;
    position: relative;
    background: #051a47;
    border-bottom: 1px solid #e2e8f0;
    position: sticky;
    z-index: 15;
    backdrop-filter: blur(10px);
}

.navbar-title {
    font-size: 1.2rem;
    font-weight: 600;
    color: #f8fafc;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* Content Wrapper */
.sidebar-content-wrapper {
    flex: 1;
    overflow-y: auto;
    padding: 20px 0 12px;
    background: #051a47;
}

/* Sections - More colorful */
.section {
    margin-bottom: 8px;
    border-radius: 12px;
    transition: all 0.2s ease;
    margin: 0 8px 6px;
}

.section-header {
    padding: 8px 12px;
    cursor: pointer;
    font-weight: 700;
    font-size: 13px;
    color: #334155;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: all 0.3s ease;
    border-radius: 10px;
    background: white;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
}

.section-header:hover {
    background: linear-gradient(135deg, #f0f4ff 0%, #e8edff 100%);
    color: #4f46e5;
    border-color: #cbd5e1;
    transform: translateX(2px);
    box-shadow: 0 4px 8px rgba(79, 70, 229, 0.08);
}

.section-chevron {
    transition: transform 0.3s ease;
    color: #94a3b8;
}

.section-chevron.expanded {
    transform: rotate(180deg);
    color: #4f46e5;
}

.section-highlight .section-header {
  background: linear-gradient(135deg, #163ab8 0%, #066582 100%);
  color: #fff;
}

/* Menu Lists */
.menu-list {
    list-style: none;
    padding: 0;
    margin: 4px 0 0 0;
    overflow: hidden;
    transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.menu-list.collapsed {
    max-height: 0;
}

.menu-list.expanded {
    max-height: 600px;
}

/* Menu Items - Enhanced */


.menu-item {
  color: white;
  padding: 7px 17px;
  cursor: pointer;
  font-size: 14px;
  position: relative;
  transition: all 0.3s ease;
  border-radius: 8px;
  margin: 2px 0px;
  margin-left: 15px;
}


.menu-item:hover {
  font-weight: 500;
  color: #08b453;
}

.menu-item.active {
    font-weight: 800;
    color: #00ff6f;
}



/* Footer - Enhanced */
.sidebar-footer {
    padding: 20px 16px;
    border-top: 1px solid #e2e8f0;
    background: #051a47;
    position: sticky;
    bottom: 0;
    font-size: 13px;
    box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.02);
}

.footer-item.user-info {
    display: flex;
    align-items: center;
    gap: 14px;
}

.user-avatar {
    width: 42px;
    height: 42px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 16px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
    box-shadow: 0 4px 10px rgba(102, 126, 234, 0.3);
}

.user-details {
    display: flex;
    flex-direction: column;
}

.user-name {
    font-weight: 700;
    color: #ffffff;
    font-size: 14px;
}

.user-role {
    font-size: 12px;
    color: #64748b;
    margin-top: 2px;
}

.footer-item.version {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    color: #475569;
    background: #f8fafc;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
}

.version-badge {
    margin-left: auto;
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
}

.footer-item svg {
    opacity: 0.8;
    color: #667eea;
}

/* Error State */
.sidebar-error {
    padding: 48px 20px;
    text-align: center;
    color: #64748b;
}

.sidebar-error svg {
    color: #ef4444;
    margin-bottom: 20px;
    opacity: 0.9;
}

.sidebar-error p {
    margin: 12px 0;
    font-size: 15px;
    color: #1f2937;
    font-weight: 600;
}

.sidebar-error button {
    padding: 10px 24px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.sidebar-error button:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
}

/* No Results */
.sidebar-no-results {
    padding: 60px 20px;
    text-align: center;
    color: #94a3b8;
}

.sidebar-no-results svg {
    margin-bottom: 20px;
    opacity: 0.5;
    color: #667eea;
}

.sidebar-no-results p {
    font-size: 16px;
    font-weight: 600;
    color: #475569;
    margin: 8px 0 4px;
}

.sidebar-no-results span {
    font-size: 13px;
    color: #94a3b8;
}

/* Loading State */
.custom-sidebar.searching .sidebar-content-wrapper {
    opacity: 0.6;
    pointer-events: none;
    filter: blur(1px);
}

/* Scrollbar Styling - Enhanced */
.custom-sidebar::-webkit-scrollbar {
    width: 8px;
}

.custom-sidebar::-webkit-scrollbar-track {
    background: #f1f5f9;
}

.custom-sidebar::-webkit-scrollbar-thumb {
    background: linear-gradient(135deg, #cbd5e1, #94a3b8);
    border-radius: 4px;
}

.custom-sidebar::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(135deg, #94a3b8, #64748b);
}

/* Animation for active item */
@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateX(-12px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}



/* Pulse animation for active item */
@keyframes pulse {
    0% {
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }
    50% {
        box-shadow: 0 4px 18px rgba(102, 126, 234, 0.5);
    }
    100% {
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }
}



/* Responsive adjustments */
@media (max-width: 768px) {
    .body-sidebar-container {
        grid-template-columns: 1fr !important;
    }
    
    .custom-sidebar {
        display: none;
    }
    
    .body-sidebar-container.menu-open .custom-sidebar {
        display: flex;
        position: fixed;
        left: 0;
        top: 0;
        bottom: 0;
        z-index: 1000;
        box-shadow: 6px 0 30px rgba(102, 126, 234, 0.15);
    }
}

.body-sidebar-container.expanded .body-sidebar-placeholder {
    display: none !important;
}
`;

// Inject styles
const styleSheet = document.createElement("style");
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

