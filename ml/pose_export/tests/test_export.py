import numpy as np
import pytest

from export import ExportError, check_output, expected_candidates


def test_expected_candidates():
    assert expected_candidates(320) == 2100
    assert expected_candidates(256) == 1344


def test_check_output_accepts_valid():
    arr = np.full((1, 56, 1344), 0.5, dtype=np.float32)
    check_output(arr, 256)


def test_check_output_rejects_wrong_shape():
    with pytest.raises(ExportError):
        check_output(np.zeros((1, 56, 2100), np.float32), 256)


def test_check_output_rejects_confidence_out_of_range():
    arr = np.full((1, 56, 1344), 0.5, np.float32)
    arr[0, 4, 0] = 3.0
    with pytest.raises(ExportError):
        check_output(arr, 256)


def test_check_output_rejects_visibility_out_of_range():
    arr = np.full((1, 56, 1344), 0.5, np.float32)
    arr[0, 7, 0] = -2.0  # joint 0 visibility row
    with pytest.raises(ExportError):
        check_output(arr, 256)
