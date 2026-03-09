import re
import requests

# Currently using the Free Dictionary API (https://dictionaryapi.dev/)
DICTIONARY_API = "https://api.dictionaryapi.dev/api/v2/entries/en/{}"

def normalize_text(text: str) -> str:
    # Aggressive clean for dictionary lookup instructions
    return re.sub(r"[^\w\-]", "", text.lower())

def is_single_word(text: str) -> bool:
    text = text.strip()
    # Remove common trailing/leading punctuation
    clean_edges = text.strip(".,;:!?\"'") 
    
    # 1. Must not contain internal spaces
    if " " in clean_edges:
        return False
        
    # 2. Must be alphanumeric (plus hyphens allowed)
    if not clean_edges.replace("-", "").isalpha():
        return False
        
    # 3. Must be standard casing (lower, Title, or UPPER) to avoid code terms like useEffect
    if not (clean_edges.islower() or clean_edges.istitle() or clean_edges.isupper()):
        return False

    # 4. Length check
    return len(clean_edges) >= 2

def lookup_dictionary(word: str) -> str | None:
    try:
        res = requests.get(DICTIONARY_API.format(word), timeout=2)
        if res.status_code != 200:
            return None

        data = res.json()
        if not isinstance(data, list) or not data:
            return None

        # Collect definitions
        found_definitions = []
        for entry in data:
            for meaning in entry.get("meanings", []):
                part_of_speech = meaning.get("partOfSpeech", "")
                for definition_entry in meaning.get("definitions", []):
                    d_text = definition_entry.get("definition")
                    if d_text:
                        # Optional: format nicely if you want part of speech
                        # found_definitions.append(f"({part_of_speech}) {d_text}")
                        found_definitions.append(d_text)
                        
                        if len(found_definitions) >= 3:
                            break
                if len(found_definitions) >= 3:
                   break
            if len(found_definitions) >= 3:
               break

        if not found_definitions:
            return None

        # Format output
        if len(found_definitions) == 1:
            return found_definitions[0]
        
        # Numbered list string
        return "\n".join([f"{i+1}. {defn}" for i, defn in enumerate(found_definitions)])

    except Exception:
        return None
