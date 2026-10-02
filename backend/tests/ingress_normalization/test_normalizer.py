import pytest

from src.ingress_normalization.normalizer import normalize_ingress
from tests.ingress_normalization.test_fixtures import GMAIL_RAW_MESSAGE, TELEGRAM_RAW_UPDATE


class TestNormalizeIngress:
    def test_dispatches_to_gmail_adapter(self):
        result = normalize_ingress("GMAIL", GMAIL_RAW_MESSAGE)
        assert result.source == "GMAIL"

    def test_dispatches_to_telegram_adapter(self):
        result = normalize_ingress("TELEGRAM", TELEGRAM_RAW_UPDATE)
        assert result.source == "TELEGRAM"

    def test_is_case_insensitive(self):
        result = normalize_ingress("gmail", GMAIL_RAW_MESSAGE)
        assert result.source == "GMAIL"

    def test_unknown_source_raises(self):
        with pytest.raises(ValueError):
            normalize_ingress("SLACK", {})
