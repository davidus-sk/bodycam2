<?php

// Function to open and configure the serial port
function openSerialPort($port, $baudrate) {
	echo "Attempting to open serial port: {$port} at {$baudrate} baud...\n";

	// Use system commands to configure the serial port (Unix-like systems)
	// This part is crucial and highly dependent on your operating system.
	// For Windows, you'd use 'MODE COMx: BAUD=115200 PARITY=N DATA=8 STOP=1'
	$command = "/usr/bin/stty -F {$port} {$baudrate} cs8 cread clocal -ixon -parenb -cstopb raw";
	exec($command, $output, $return_var);

	if ($return_var !== 0) {
		echo "Error configuring serial port with stty: " . implode("\n", $output) . "\n";
		return false;
	}//if

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

// --- Main execution ---
$serialPort = '/dev/ttyUSB3'; // Change this for Windows (e.g., 'COM1')
$baudRate = 115200;
$loopDelaySeconds = 2; // Delay between command cycles

$serialHandle = false; // Initialize handle to false

try {
	$serialHandle = openSerialPort($serialPort, $baudRate);

	if ($serialHandle) {
		echo "Starting communication loop...\n";
		while (true) {
			$data = sendAndRead($serialHandle, "AT+CGPSINFO\n", 0); // Delay handled by usleep in sendAndRead if needed
			echo "$data\n";
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