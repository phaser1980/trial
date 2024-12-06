const { sequelize } = require('../config/database');
const logger = require('./logger');
const AppError = require('./AppError'); // Assuming AppError is defined in this file

const REQUIRED_TABLES = [
    'sequences_partitioned',
    'mv_sequence_analytics',
    'mv_enhanced_sequence_analytics'
];

class DatabaseValidator {
    static async validateFunctions() {
        const requiredFunctions = [
            { 
                name: 'analyze_transition_patterns',
                signature: 'uuid',
                hint: 'Run the migration script at db/migrations/20240124_create_analyze_transition_patterns.sql'
            },
            { 
                name: 'calculate_transition_matrix',
                signature: 'uuid',
                hint: 'Run the migration script at db/migrations/20240124_create_calculate_transition_matrix.sql'
            },
            { 
                name: 'compare_seed_sequences',
                signature: 'uuid, integer, integer, text',
                hint: 'Run the migration script at db/migrations/20240124_create_compare_seed_sequences.sql'
            },
            { 
                name: 'monte_carlo_seed_search',
                signature: 'uuid',
                hint: 'Run the migration script at db/migrations/20240124_create_monte_carlo_seed_search.sql'
            },
            { 
                name: 'calculate_sequence_similarity',
                signature: 'uuid',
                hint: 'Run the migration script at db/migrations/20240124_create_calculate_sequence_similarity.sql'
            }
        ];

        for (const fn of requiredFunctions) {
            try {
                const [result] = await sequelize.query(`
                    SELECT proname, proargtypes::regtype[] as argtypes
                    FROM pg_proc
                    WHERE proname = :name
                `, { 
                    replacements: { name: fn.name },
                    type: sequelize.QueryTypes.SELECT
                });

                if (!result) {
                    throw new AppError('DB_FUNCTION_ERROR',
                        `Missing database function: ${fn.name}\nHint: ${fn.hint}`,
                        500
                    );
                }

                // Verify function signature
                const expectedTypes = fn.signature.split(',').map(t => t.trim());
                const actualTypes = result.argtypes;

                if (expectedTypes.length !== actualTypes.length || 
                    !expectedTypes.every((type, i) => actualTypes[i].toLowerCase().includes(type))) {
                    throw new AppError('DB_FUNCTION_ERROR',
                        `Invalid signature for function ${fn.name}.\n` +
                        `Expected: (${fn.signature})\n` +
                        `Found: (${actualTypes.join(', ')})\n` +
                        `Hint: ${fn.hint}`,
                        500
                    );
                }

                logger.logValidation(`Validated function ${fn.name}`, {
                    component: 'dbValidator',
                    function: 'validateFunctions',
                    type: 'function',
                    status: 'success'
                });
            } catch (error) {
                logger.logValidation(`Function validation failed for ${fn.name}`, {
                    component: 'dbValidator',
                    function: 'validateFunctions',
                    type: 'function',
                    status: 'error',
                    details: error.message
                });
                throw error;
            }
        }
    }

    static async validateTables() {
        const results = await Promise.all(
            REQUIRED_TABLES.map(async (tableName) => {
                const [result] = await sequelize.query(`
                    SELECT EXISTS (
                        SELECT 1 
                        FROM information_schema.tables 
                        WHERE table_name = :tableName
                    );
                `, {
                    replacements: { tableName },
                    type: sequelize.QueryTypes.SELECT
                });

                return {
                    name: tableName,
                    exists: result.exists
                };
            })
        );

        const missing = results.filter(r => !r.exists);
        if (missing.length > 0) {
            logger.error('Missing required database tables:', {
                missing: missing.map(m => m.name),
                hint: 'Check migration files and ensure all required tables are created'
            });
            throw new Error(`Missing required database tables: ${missing.map(m => m.name).join(', ')}`);
        }

        logger.info('All required database tables validated successfully');
        return true;
    }

    static async validateAll() {
        try {
            await this.validateFunctions();
            await this.validateTables();
            logger.info('Database validation completed successfully');
        } catch (error) {
            logger.error('Database validation failed', error);
            throw error;
        }
    }
}

module.exports = DatabaseValidator;
