"""Small text helpers shared by the semantic nav nodes."""


def plural_forms(word):
    """Common English plural forms of a (singular) category name."""
    w = word.strip().lower()
    forms = {w, w + 's', w + 'es'}
    if w.endswith('y') and len(w) > 1 and w[-2] not in 'aeiou':
        forms.add(w[:-1] + 'ies')
    return forms


def category_matches(semantic_type, target):
    """True if a spoken category ("houses", "all parks") refers to a label type ("house")."""
    t = target.strip().lower()
    if t.startswith('all '):
        t = t[4:].strip()
    s = semantic_type.strip().lower()
    if not t or not s:
        return False
    return t in plural_forms(s) or s in plural_forms(t)
