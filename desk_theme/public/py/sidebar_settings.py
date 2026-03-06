import frappe

@frappe.whitelist()
def get_sidebar_items():
    settings = frappe.get_single("Desk Sidebar")
    items = settings.sidebar_items or []

    result = []
    for row in items:
        result.append({
            "label": row.label or "",
            "url": row.url or "",
            "parent1": row.parent1 or "",
            "icon": row.icon or "",
            "sequence": row.sequence or 0
        })

    return result