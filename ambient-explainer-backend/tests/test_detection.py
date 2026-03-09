from app.utils import is_single_word

def test_single_word():
    assert is_single_word("hydration") is True
    assert is_single_word("Hydration.") is True
    assert is_single_word("water") is True

def test_sentence():
    assert is_single_word("drink more water") is False
    assert is_single_word("the board deferred the motion") is False

def test_edge_cases():
    assert is_single_word("U.S.A") is False
    assert is_single_word("useEffect") is False
    assert is_single_word("a") is False
    assert is_single_word("") is False
