import yaml
from pathlib import Path
from datetime import time

_config = None


def load_config():
    global _config
    if _config is not None:
        return _config
    config_path = Path(__file__).parent / "config.yaml"
    with open(config_path, "r") as f:
        _config = yaml.safe_load(f)

    hours = _config["restaurant"]["hours"]
    parsed = {}
    for day, hh_range in hours.items():
        start_str, end_str = hh_range.split("-")
        h1, m1 = start_str.split(":")
        h2, m2 = end_str.split(":")
        parsed[day] = (time(int(h1), int(m1)), time(int(h2), int(m2)))
    _config["restaurant"]["hours_parsed"] = parsed

    return _config


def get_config():
    if _config is None:
        return load_config()
    return _config
