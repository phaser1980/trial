const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const PORTS_TO_KILL = [5000, 42351]; // Add both frontend and backend ports

async function findAndKillProcesses() {
    try {
        // On Windows, use netstat to find processes
        const { stdout } = await execAsync('netstat -ano | findstr "LISTENING"');
        
        for (const port of PORTS_TO_KILL) {
            const regex = new RegExp(`:${port}\\s+.*?\\s+(\\d+)`, 'g');
            const matches = [...stdout.matchAll(regex)];
            
            for (const match of matches) {
                const pid = match[1];
                try {
                    await execAsync(`taskkill /F /PID ${pid}`);
                    console.log(`Successfully killed process ${pid} on port ${port}`);
                } catch (err) {
                    if (!err.message.includes('not found')) {
                        console.error(`Error killing process ${pid} on port ${port}:`, err.message);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error finding processes:', error.message);
    }
}

// Add delay and retry logic
async function killWithRetry(maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        await findAndKillProcesses();
        
        // Wait a bit to let processes fully terminate
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Check if ports are now free
        try {
            const { stdout } = await execAsync('netstat -ano | findstr "LISTENING"');
            const portsStillInUse = PORTS_TO_KILL.filter(port => 
                stdout.includes(`:${port}`)
            );
            
            if (portsStillInUse.length === 0) {
                console.log('All ports successfully freed');
                return;
            }
            
            console.log(`Retry ${i + 1}: Some ports still in use:`, portsStillInUse);
        } catch (error) {
            console.error('Error checking ports:', error.message);
        }
    }
    
    console.log('Maximum retries reached. Please check processes manually.');
}

killWithRetry();
