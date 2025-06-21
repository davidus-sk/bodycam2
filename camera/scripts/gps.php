<?php

// Function to open and configure the serial port
function openSerialPort($port, $baudrate) {
	echo "Attempting to open serial port: {$port} at {$baudrate} baud...\n";

	// Use system commands to configure the serial port (Unix-like systems)
	// This part is crucial and highly dependent on your operating system.
	// For Windows, you'd use 'MODE COMx: BAUD=115200 PARITY=N DATA=8 STOP=1'
/*	$command = "/usr/bin/stty -F {$port} {$baudrate}";
	exec($command, $output, $return_var);

	if ($return_var !== 0) {
		echo "Error configuring serial port with stty: " . implode("\n", $output) . "\n";
		return false;
	}//if
*/
	echo "Serial port configured.\n";

	// Open the serial port as a file
	$handle = @fopen($port, 'r+b'); // r+b for read/write binary mode
	if (!$handle) {
		echo "Error: Could not open serial port {$port}. Check permissions or if it's in use.\n";
		return false;
	}//if

	// Set non-blocking mode (optional, but often useful for serial comms)
	// stream_set_blocking($handle, false); // For non-blocking reads

	// Set timeout for read operations (if blocking is enabled)
	stream_set_timeout($handle, 1); // 1 second timeout

	echo "Successfully opened serial port: {$port}\n";
	return $handle;
}

// Function to send a command and read a line
function sendAndRead($serialHandle, $command, $delay) {
	if (!$serialHandle) {
		echo "Serial port not open.\n";
		return false;
	}

	// Send the command
	$bytesWritten = fwrite($serialHandle, $command);
	if ($bytesWritten === false) {
		echo "Error: Could not write to serial port.\n";
		return false;
	}

	echo "Sent command: '" . rtrim($command) . "' (" . $bytesWritten . " bytes)\n";

	// Ensure data is sent
	fflush($serialHandle);

	// Give the device time to respond
	usleep($delay * 1000000); // usleep takes microseconds

	// Read a line back
	// fread reads a specified number of bytes, or until EOF
	// For line-by-line reading, you might need a loop to read character by character
	// until a newline, or rely on a timeout and buffer if the device always sends lines.
	// This example reads up to 255 bytes, assuming the response is within this limit.
	$response = "";
	$buffer = "";
	$startTime = microtime(true);
	$timeout = 1; // seconds

	while (true) {
		$char = fgetc($serialHandle);
		if ($char === false || microtime(true) - $startTime > $timeout) {
			// No more data or timeout
			break;
		}//if

		$buffer .= $char;
		if (strpos($buffer, "\n") !== false) {
			// Found a newline, process the line
			$response = trim($buffer); // Remove leading/trailing whitespace including newline
			break;
		}//if
	}//while

	if (!empty($response)) {
		echo "Received response: '{$response}'\n";
	} else {
		echo "No response received within timeout.\n";
	}//if

	return $response;
}

/**
 * Converts a GPS coordinate string from DDMM.MMMM,N/S,DDDMM.MMMM,E/W format to decimal degrees.
 *
 * @param string $gpsString The GPS coordinate string (e.g., "3015.177003,N,08134.332917,W").
 * @return array|false An associative array with 'latitude' and 'longitude' in decimal degrees,
 * or false if the input string format is invalid.
 */
function convertGpsToDecimal($gpsString) {
    // 1. Parse the input string
    $parts = explode(',', $gpsString);

    // Ensure we have exactly 4 parts: lat_val, lat_dir, lon_val, lon_dir
    if (count($parts) !== 4) {
        error_log("Invalid GPS string format: Expected 4 parts, got " . count($parts));
        return false;
    }

    list($latValueStr, $latDirection, $lonValueStr, $lonDirection) = $parts;

    // --- Process Latitude ---
    // Extract degrees and minutes for latitude (DDMM.MMMM)
    // The degrees are the first two digits.
    if (strlen($latValueStr) < 2) {
        error_log("Invalid latitude value format: '{$latValueStr}'");
        return false;
    }
    $latDegrees = (float) substr($latValueStr, 0, 2);
    $latMinutes = (float) substr($latValueStr, 2); // Remainder is minutes

    // Calculate decimal latitude
    $decimalLatitude = $latDegrees + ($latMinutes / 60);

    // Apply sign based on direction (N is positive, S is negative)
    if (strtoupper($latDirection) === 'S') {
        $decimalLatitude *= -1;
    } elseif (strtoupper($latDirection) !== 'N') {
        error_log("Invalid latitude direction: '{$latDirection}'");
        return false;
    }

    // --- Process Longitude ---
    // Extract degrees and minutes for longitude (DDDMM.MMMM)
    // The degrees are the first three digits.
    if (strlen($lonValueStr) < 3) {
        error_log("Invalid longitude value format: '{$lonValueStr}'");
        return false;
    }
    $lonDegrees = (float) substr($lonValueStr, 0, 3);
    $lonMinutes = (float) substr($lonValueStr, 3); // Remainder is minutes

    // Calculate decimal longitude
    $decimalLongitude = $lonDegrees + ($lonMinutes / 60);

    // Apply sign based on direction (E is positive, W is negative)
    if (strtoupper($lonDirection) === 'W') {
        $decimalLongitude *= -1;
    } elseif (strtoupper($lonDirection) !== 'E') {
        error_log("Invalid longitude direction: '{$lonDirection}'");
        return false;
    }

    return [
        'latitude' => $decimalLatitude,
        'longitude' => $decimalLongitude
    ];
}

// --- Main execution ---
$serialPort = '/dev/ttyUSB3'; // Change this for Windows (e.g., 'COM1')
$baudRate = 115200;
$loopDelaySeconds = 2; // Delay between command cycles

$serialHandle = false; // Initialize handle to false

try {
	$serialHandle = openSerialPort($serialPort, $baudRate);

	if ($serialHandle) {
		echo "Starting communication loop...\n";
		sendAndRead($serialHandle, "AT+CGPS=1\r\n", 0);

		while (true) {
			$data = sendAndRead($serialHandle, "AT+CGPSINFO\r\n", 0); // Delay handled by usleep in sendAndRead if needed

			// +CGPSINFO: 3015.177003,N,08134.332917,W,210625,010533.0,23.5,0.0,
			if (preg_match("/CGPSINFO: ([0-9.]+,[NWES],[0-9.]+,[NWES])/", $data, $m)) {
				$decimalCoords = convertGpsToDecimal($m[1]);

				echo "LAT: {$decimalCoords['latitude']}, LON: {$decimalCoords['longitude']}\n";
			}//if

			sleep($loopDelaySeconds); // Delay between iterations
		}//while
	}//if
} catch (Exception $e) {
	echo "An error occurred: " . $e->getMessage() . "\n";
} finally {
	if ($serialHandle && is_resource($serialHandle)) {
		fclose($serialHandle);
		echo "Serial port {$serialPort} closed.\n";
	}//if
}//try
