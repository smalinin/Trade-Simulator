/* 
 * GPL 3.0 license <http://www.gnu.org/licenses/>
*/

/**
 * CandleLoader - class for loading and storing OHLCV data from CSV files
 * Supports various date and time formats
 */
class CandleLoader {
    /**
     * CandleLoader class constructor
     * @param {Object} options - loader options
     * @param {string} options.dataTZ - timezone of data in CSV ('UTC', 'local', 'GMT+1', or IANA timezone like 'Europe/Moscow')
     * @param {string} options.outputTZ - timezone for output data ('UTC', 'local', 'GMT+1', or IANA timezone)
     * @param {boolean} options.preserveOriginal - preserve original date/time
     */
    constructor(options = {}) {
        this.data = [];
        this.columns = {};
        this.isLoaded = false;
        
        // Timezone settings
        this.dataTZ = options.dataTZ || 'UTC';  // Source data TZ
        this.outputTZ = options.outputTZ || 'UTC';  // Output TZ
        this.preserveOriginal = options.preserveOriginal !== false;  // Preserve original date
        
        // Parse GMT offset if specified
        this.dataTZOffset = this.parseGMTOffset(this.dataTZ);
        this.outputTZOffset = this.parseGMTOffset(this.outputTZ);
        
        // Metadata
        this.metadata = {
            dataTZ: this.dataTZ,
            outputTZ: this.outputTZ,
            dataTZOffset: this.dataTZOffset,
            outputTZOffset: this.outputTZOffset,
            loadTime: null,
            sourceFile: null
        };
    }

    /**
     * Parse GMT offset from string like 'GMT+1' or 'GMT-5'
     * @param {string} tzString - timezone string
     * @returns {number|null} - offset in minutes or null if not GMT
     */
    parseGMTOffset(tzString) {
        if (!tzString || typeof tzString !== 'string') {
            return null;
        }
        
        // Support GMT+X, GMT-X, UTC+X, UTC-X
        const match = tzString.match(/^(GMT|UTC)([+-])(\d+(?:\.\d+)?)$/i);
        if (match) {
            const sign = match[2] === '+' ? 1 : -1;
            const hours = parseFloat(match[3]);
            return sign * hours * 60; // Return in minutes
        }
        
        return null;
    }

    /**
     * Load data from CSV file
     * @param {string} filePath - path to CSV file
     * @returns {Promise} - promise with loaded data
     */
    async loadFromFile(filePath) {
        return new Promise((resolve, reject) => {
            Papa.parse(filePath, {
                download: true,
                header: true,
                dynamicTyping: false,
                skipEmptyLines: true,
                complete: (results) => {
                    try {
                        this.processData(results.data, results.meta.fields);
                        this.isLoaded = true;
                        this.metadata.loadTime = new Date();
                        this.metadata.sourceFile = filePath;
                        resolve(this.data);
                    } catch (error) {
                        reject(error);
                    }
                },
                error: (error) => {
                    reject(error);
                }
            });
        });
    }

    /**
     * Load data from CSV string
     * @param {string} csvString - string with CSV data
     * @returns {Array} - array of processed data
     */
    loadFromString(csvString) {
        const results = Papa.parse(csvString, {
            header: true,
            dynamicTyping: false,
            skipEmptyLines: true
        });
        
        this.processData(results.data, results.meta.fields);
        this.isLoaded = true;
        this.metadata.loadTime = new Date();
        this.metadata.sourceFile = 'string';
        return this.data;
    }

    /**
     * Process loaded data
     * @param {Array} rawData - raw data from CSV
     * @param {Array} fields - column names
     */
    processData(rawData, fields) {
        this.columns = fields;
        this.data = [];

        for (let i=0; i< fields.length; i++)
            this.columns[fields[i].toLowerCase().trim()] = fields[i];

        const hasDatetime = 'datetime' in this.columns;
        const hasDate = 'date' in this.columns;
        const hasTime = 'time' in this.columns;

        const k_datetime = this.columns['datetime'];
        const k_date = this.columns['date'];
        const k_time = this.columns['time'];
        const k_open = this.columns['open'];
        const k_high = this.columns['high'];
        const k_low = this.columns['low'];
        const k_close = this.columns['close'];
        const k_volume = this.columns['volume'];

        for (let row of rawData) {
            try {
                let timestamp;

                if (hasDatetime) {
                    // Format: YYYY-MM-DD HH:MM:SS
                    timestamp = this.parseDatetime(row[k_datetime]);
                } else if (hasDate) {
                    const date = row[k_date];
                    const time = hasTime ? row[k_time] : '0000';
                    timestamp = this.parseDateAndTime(date, time);
                } else {
                    throw new Error('No date/time columns found in CSV');
                }

                const candle = {
                    timestamp: timestamp,
                    date: new Date(timestamp),
                    open: parseFloat(row[k_open]),
                    high: parseFloat(row[k_high]),
                    low: parseFloat(row[k_low]),
                    close: parseFloat(row[k_close]),
                    volume: parseFloat(row[k_volume] || 0)
                };

                // Add original date if needed
                if (this.preserveOriginal && this.dataTZ !== this.outputTZ) {
                    candle.originalDate = new Date(timestamp);
                    candle.originalTimestamp = timestamp;
                }

                this.data.push(candle);
            } catch (error) {
                console.warn('Skipping invalid row:', row, error.message);
            }
        }

        // Sort by time
        // this.data.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Parse datetime string with timezone support
     * @param {string} datetimeStr - string in format YYYY-MM-DD HH:MM:SS
     * @returns {number} - timestamp in milliseconds
     */
    parseDatetime(datetimeStr) {
        let timestamp;
        
        if (this.dataTZ === 'UTC') {
            // Parse as UTC
            timestamp = Date.parse(datetimeStr + 'Z');
        } else if (this.dataTZ === 'local') {
            // Parse as local time
            timestamp = new Date(datetimeStr).getTime();
        } else if (this.dataTZOffset !== null) {
            // Parse with GMT offset (e.g. GMT+3)
            // First parse as UTC
            timestamp = Date.parse(datetimeStr + 'Z');
            // Then subtract offset (if data is in GMT+3, it's 3 hours ahead of UTC)
            timestamp = timestamp - (this.dataTZOffset * 60 * 1000);
        } else {
            // For IANA timezone use UTC as base
            // TODO: For accurate IANA TZ support need library like moment-timezone
            timestamp = Date.parse(datetimeStr + 'Z');
            console.warn(`IANA timezone ${this.dataTZ} not fully supported, treating as UTC`);
        }
        
        if (isNaN(timestamp)) {
            throw new Error(`Invalid datetime format: ${datetimeStr}`);
        }
        
        return timestamp;
    }

    /**
     * Parse separate date and time fields with timezone support
     * @param {string} dateStr - date string (YYYYMMDD or YYYY-MM-DD)
     * @param {string} timeStr - time string (HHMM, HHMMSS, HH:MM, HH:MM:SS)
     * @returns {number} - timestamp in milliseconds
     */
    parseDateAndTime(dateStr, timeStr) {
        const dateParsed = this.parseDate(dateStr);
        const timeParsed = this.parseTime(timeStr);
        
        let timestamp;
        
        if (this.dataTZ === 'UTC') {
            // Create date in UTC
            const date = new Date(Date.UTC(
                dateParsed.year,
                dateParsed.month - 1,
                dateParsed.day,
                timeParsed.hour,
                timeParsed.minute,
                timeParsed.second
            ));
            timestamp = date.getTime();
        } else if (this.dataTZ === 'local') {
            // Create date in local timezone
            const date = new Date(
                dateParsed.year,
                dateParsed.month - 1,
                dateParsed.day,
                timeParsed.hour,
                timeParsed.minute,
                timeParsed.second
            );
            timestamp = date.getTime();
        } else if (this.dataTZOffset !== null) {
            // Create date with GMT offset (e.g. GMT+3)
            // First create in UTC
            const date = new Date(Date.UTC(
                dateParsed.year,
                dateParsed.month - 1,
                dateParsed.day,
                timeParsed.hour,
                timeParsed.minute,
                timeParsed.second
            ));
            timestamp = date.getTime();
            // Subtract offset (if data is in GMT+3, it's 3 hours ahead of UTC)
            timestamp = timestamp - (this.dataTZOffset * 60 * 1000);
        } else {
            // For IANA timezone use UTC as base
            const date = new Date(Date.UTC(
                dateParsed.year,
                dateParsed.month - 1,
                dateParsed.day,
                timeParsed.hour,
                timeParsed.minute,
                timeParsed.second
            ));
            timestamp = date.getTime();
            console.warn(`IANA timezone ${this.dataTZ} not fully supported, treating as UTC`);
        }

        if (isNaN(timestamp)) {
            throw new Error(`Invalid date/time: ${dateStr} ${timeStr}`);
        }

        return timestamp;
    }

    /**
     * Parse date string
     * @param {string} dateStr - date string (YYYYMMDD or YYYY-MM-DD)
     * @returns {Object} - object with year, month, day
     */
    parseDate(dateStr) {
        let year, month, day;

        // Remove spaces
        dateStr = dateStr.trim();

        if (dateStr.includes('-')) {
            // Format: YYYY-MM-DD
            const parts = dateStr.split('-');
            year = parseInt(parts[0]);
            month = parseInt(parts[1]);
            day = parseInt(parts[2]);
        } else if (dateStr.length === 8) {
            // Format: YYYYMMDD
            year = parseInt(dateStr.substring(0, 4));
            month = parseInt(dateStr.substring(4, 6));
            day = parseInt(dateStr.substring(6, 8));
        } else {
            throw new Error(`Unknown date format: ${dateStr}`);
        }

        return { year, month, day };
    }

    /**
     * Parse time string
     * @param {string} timeStr - time string (HHMM, HHMMSS, HH:MM, HH:MM:SS)
     * @returns {Object} - object with hour, minute, second
     */
    parseTime(timeStr) {
        let hour = 0, minute = 0, second = 0;

        if (!timeStr) {
            return { hour, minute, second };
        }

        // Remove spaces
        timeStr = timeStr.trim();

        if (timeStr.includes(':')) {
            // Format: HH:MM or HH:MM:SS
            const parts = timeStr.split(':');
            hour = parseInt(parts[0]);
            minute = parseInt(parts[1]);
            second = parts.length > 2 ? parseInt(parts[2]) : 0;
        } else if (timeStr.length === 4) {
            // Format: HHMM
            hour = parseInt(timeStr.substring(0, 2));
            minute = parseInt(timeStr.substring(2, 4));
        } else if (timeStr.length === 6) {
            // Format: HHMMSS
            hour = parseInt(timeStr.substring(0, 2));
            minute = parseInt(timeStr.substring(2, 4));
            second = parseInt(timeStr.substring(4, 6));
        } else {
            throw new Error(`Unknown time format: ${timeStr}`);
        }

        return { hour, minute, second };
    }

    /**
     * Get all data
     * @returns {Array} - array of candles
     */
    getData() {
        return this.data;
    }

    /**
     * Get candle by index
     * @param {number} index - candle index
     * @returns {Object|null} - candle object or null
     */
    getCandle(index) {
        if (index < 0 || index >= this.data.length) {
            return null;
        }
        return this.data[index];
    }

    /**
     * Get data in index range
     * @param {number} startIndex - start index
     * @param {number} endIndex - end index
     * @returns {Array} - array of candles
     */
    getDataRange(startIndex, endIndex) {
        return this.data.slice(startIndex, endIndex + 1);
    }

    /**
     * Get data in date range
     * @param {Date|number} startDate - start date
     * @param {Date|number} endDate - end date
     * @returns {Array} - array of candles
     */
    getDataByDateRange(startDate, endDate) {
        const startTimestamp = startDate instanceof Date ? startDate.getTime() : startDate;
        const endTimestamp = endDate instanceof Date ? endDate.getTime() : endDate;

        return this.data.filter(candle => 
            candle.timestamp >= startTimestamp && candle.timestamp <= endTimestamp
        );
    }

    /**
     * Get candle count
     * @returns {number} - number of candles
     */
    getCount() {
        return this.data.length;
    }

    /**
     * Get column names
     * @returns {Array} - array of column names
     */
    getColumns() {
        return this.columns;
    }

    /**
     * Check if data is loaded
     * @returns {boolean} - true if data is loaded
     */
    isDataLoaded() {
        return this.isLoaded;
    }

    /**
     * Get first candle
     * @returns {Object|null} - first candle or null
     */
    getFirst() {
        return this.data.length > 0 ? this.data[0] : null;
    }

    /**
     * Get last candle
     * @returns {Object|null} - last candle or null
     */
    getLast() {
        return this.data.length > 0 ? this.data[this.data.length - 1] : null;
    }

    /**
     * Get date range
     * @returns {Object} - object with start and end dates
     */
    getDateRange() {
        if (this.data.length === 0) {
            return null;
        }
        return {
            start: this.data[0].date,
            end: this.data[this.data.length - 1].date,
            startTimestamp: this.data[0].timestamp,
            endTimestamp: this.data[this.data.length - 1].timestamp
        };
    }

    /**
     * Get data statistics
     * @returns {Object} - object with statistics
     */
    getStatistics() {
        if (this.data.length === 0) {
            return null;
        }

        let maxHigh = -Infinity;
        let minLow = Infinity;
        let totalVolume = 0;
        let avgVolume = 0;

        for (let candle of this.data) {
            maxHigh = Math.max(maxHigh, candle.high);
            minLow = Math.min(minLow, candle.low);
            totalVolume += candle.volume;
        }

        avgVolume = totalVolume / this.data.length;

        return {
            count: this.data.length,
            maxHigh: maxHigh,
            minLow: minLow,
            totalVolume: totalVolume,
            avgVolume: avgVolume,
            dateRange: this.getDateRange()
        };
    }

    /**
     * Clear data
     */
    clear() {
        this.data = [];
        this.columns = [];
        this.isLoaded = false;
        this.metadata.loadTime = null;
        this.metadata.sourceFile = null;
    }

    /**
     * Get metadata about loaded data
     * @returns {Object} - object with metadata
     */
    getMetadata() {
        return {
            ...this.metadata,
            count: this.data.length,
            isLoaded: this.isLoaded
        };
    }

    /**
     * Set data timezone
     * @param {string} timezone - timezone ('UTC', 'local', 'GMT+3', or IANA timezone)
     */
    setDataTZ(timezone) {
        this.dataTZ = timezone;
        this.dataTZOffset = this.parseGMTOffset(timezone);
        this.metadata.dataTZ = timezone;
        this.metadata.dataTZOffset = this.dataTZOffset;
    }

    /**
     * Set output timezone
     * @param {string} timezone - timezone ('UTC', 'local', 'GMT+3', or IANA timezone)
     */
    setOutputTZ(timezone) {
        this.outputTZ = timezone;
        this.outputTZOffset = this.parseGMTOffset(timezone);
        this.metadata.outputTZ = timezone;
        this.metadata.outputTZOffset = this.outputTZOffset;
    }

    /**
     * Convert timestamp to string with timezone support
     * @param {number} timestamp - timestamp in milliseconds
     * @param {string} timezone - timezone (optional, defaults to outputTZ)
     * @returns {string} - date/time string
     */
    formatDate(timestamp, timezone = null) {
        const tz = timezone || this.outputTZ;
        let adjustedTimestamp = timestamp;
        
        // Check if there is GMT offset
        const gmtOffset = this.parseGMTOffset(tz);
        if (gmtOffset !== null) {
            // Add offset for display
            adjustedTimestamp = timestamp + (gmtOffset * 60 * 1000);
        }
        
        const date = new Date(adjustedTimestamp);
        
        if (tz === 'UTC' || gmtOffset !== null) {
            // For UTC and GMT offsets use ISO format
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');
            const hours = String(date.getUTCHours()).padStart(2, '0');
            const minutes = String(date.getUTCMinutes()).padStart(2, '0');
            const seconds = String(date.getUTCSeconds()).padStart(2, '0');
            return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        } else if (tz === 'local') {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const seconds = String(date.getSeconds()).padStart(2, '0');
            return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        } else {
            // For IANA timezone use Intl.DateTimeFormat
            try {
                const formatter = new Intl.DateTimeFormat('en-CA', {
                    timeZone: tz,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                });
                return formatter.format(new Date(timestamp)).replace(',', '');
            } catch (e) {
                console.warn(`Invalid timezone ${tz}, using UTC`);
                return new Date(timestamp).toISOString().replace('T', ' ').substring(0, 19);
            }
        }
    }

    /**
     * Get timezone offset in minutes
     * @param {string} timezone - timezone
     * @param {number} timestamp - timestamp for checking (for DST support)
     * @returns {number} - offset in minutes
     */
    getTimezoneOffset(timezone, timestamp = Date.now()) {
        if (timezone === 'UTC') {
            return 0;
        } else if (timezone === 'local') {
            return -new Date(timestamp).getTimezoneOffset(); // Invert sign to match GMT
        }
        
        // Check GMT offset
        const gmtOffset = this.parseGMTOffset(timezone);
        if (gmtOffset !== null) {
            return gmtOffset;
        }
        
        // For IANA timezone
        try {
            const date = new Date(timestamp);
            const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
            const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
            return (tzDate.getTime() - utcDate.getTime()) / 60000;
        } catch (e) {
            console.warn(`Cannot calculate offset for ${timezone}`);
            return 0;
        }
    }

}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CandleLoader;
}
