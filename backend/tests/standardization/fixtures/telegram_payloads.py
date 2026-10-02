"""
Sample Telegram Bot API payloads for standardization tests.

Ported from the old src/ingress_normalization test fixtures (real, documented
Telegram Bot API Update/Message shapes), extended with audio/video/photo,
channel_post, and bare-Message cases the new adapter also has to handle.
"""

UPDATE_WITH_DOCUMENT = {
    "update_id": 987654,
    "message": {
        "message_id": 123,
        "date": 1755683400,
        "from": {"id": 456, "is_bot": False, "first_name": "John", "username": "supplier"},
        "chat": {"id": 456, "type": "private"},
        "text": "Please process the attached invoice.",
        "document": {
            "file_id": "BAACAgIAAxkBAA",
            "file_name": "invoice.pdf",
            "mime_type": "application/pdf",
            "file_size": 45231,
        },
    },
}

UPDATE_TEXT_ONLY_NO_USERNAME = {
    "update_id": 987655,
    "message": {
        "message_id": 124,
        "date": 1755683400,
        "from": {"id": 789, "is_bot": False, "first_name": "Jane"},
        "chat": {"id": 789, "type": "private"},
        "text": "What is the status of my order?",
    },
}

BARE_MESSAGE_NO_USERNAME = dict(UPDATE_TEXT_ONLY_NO_USERNAME["message"])

MISSING_SENDER = {
    "message": {
        "message_id": 200,
        "date": 1755683400,
        "chat": {"id": 1, "type": "private"},
        "text": "Hello",
    },
}

MISSING_MESSAGE_ID = {
    "message": {
        "date": 1755683400,
        "from": {"id": 456, "is_bot": False, "first_name": "John"},
        "chat": {"id": 456, "type": "private"},
        "text": "Hello",
    },
}

MISSING_DATE = {
    "message": {
        "message_id": 201,
        "from": {"id": 456, "is_bot": False, "first_name": "John"},
        "chat": {"id": 456, "type": "private"},
        "text": "Hello",
    },
}

MALFORMED_DOCUMENT = {
    "message": {
        "message_id": 202,
        "date": 1755683400,
        "from": {"id": 456, "is_bot": False, "first_name": "John"},
        "chat": {"id": 456, "type": "private"},
        "text": "See attached",
        "document": {"file_name": "broken.pdf", "mime_type": "application/pdf"},  # no file_id
    },
}

EDITED_MESSAGE_UPDATE = {
    "update_id": 1,
    "edited_message": {
        "message_id": 123,
        "date": 1755683400,
        "from": {"id": 456, "first_name": "John"},
        "chat": {"id": 456, "type": "private"},
        "text": "edited text",
    },
}

CHANNEL_POST_UPDATE = {
    "update_id": 2,
    "channel_post": {
        "message_id": 500,
        "date": 1755683400,
        "chat": {"id": -100123, "type": "channel"},
        "text": "announcement",
    },
}

AUDIO_MESSAGE = {
    "update_id": 3,
    "message": {
        "message_id": 300,
        "date": 1755683400,
        "from": {"id": 456, "first_name": "John", "username": "supplier"},
        "chat": {"id": 456, "type": "private"},
        "caption": "voice memo",
        "audio": {"file_id": "AUDIO123", "file_name": "memo.mp3", "mime_type": "audio/mpeg", "file_size": 2048},
    },
}

VIDEO_MESSAGE = {
    "update_id": 4,
    "message": {
        "message_id": 301,
        "date": 1755683400,
        "from": {"id": 456, "first_name": "John", "username": "supplier"},
        "chat": {"id": 456, "type": "private"},
        "caption": "video memo",
        "video": {"file_id": "VIDEO123", "file_name": "clip.mp4", "mime_type": "video/mp4", "file_size": 4096},
    },
}

PHOTO_MESSAGE = {
    "update_id": 5,
    "message": {
        "message_id": 302,
        "date": 1755683400,
        "from": {"id": 456, "first_name": "John", "username": "supplier"},
        "chat": {"id": 456, "type": "private"},
        "photo": [
            {"file_id": "PHOTO_SMALL", "file_size": 1000},
            {"file_id": "PHOTO_BIG", "file_size": 5000},
        ],
    },
}

MALFORMED_PHOTO_NO_FILE_ID = {
    "update_id": 6,
    "message": {
        "message_id": 303,
        "date": 1755683400,
        "from": {"id": 456, "first_name": "John", "username": "supplier"},
        "chat": {"id": 456, "type": "private"},
        "photo": [{"file_size": 1000}],
    },
}

GARBAGE_UPDATE = {"foo": "bar"}
