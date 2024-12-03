import psycopg2
from psycopg2.extras import RealDictCursor
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:Redman1303!@localhost:5432/postgres')

def validate_database():
    try:
        connection = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        cursor = connection.cursor()

        cursor.execute("SELECT NOW();")
        current_time = cursor.fetchone()
        print(f"Database connection successful. Current time: {current_time['now']}")

        required_tables = ["sequences", "model_predictions", "model_performance"]
        for table in required_tables:
            cursor.execute(f"""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_schema = 'public'
                    AND table_name = %s
                );
            """, (table,))
            exists = cursor.fetchone()["exists"]
            print(f"Table '{table}' exists: {exists}")

        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM pg_matviews
                WHERE matviewname = 'recent_model_performance'
            );
        """)
        mv_exists = cursor.fetchone()["exists"]
        print(f"Materialized view 'recent_model_performance' exists: {mv_exists}")

        cursor.execute("""
            SELECT inhrelid::regclass AS child
            FROM pg_inherits
            WHERE inhparent = 'sequences'::regclass
            UNION ALL
            SELECT inhrelid::regclass AS child
            FROM pg_inherits
            WHERE inhparent = 'model_predictions'::regclass;
        """)
        partitions = cursor.fetchall()
        print("Partitioned tables:")
        for partition in partitions:
            print(f"  - {partition['child']}")

    except Exception as e:
        print(f"Error validating database: {e}")
    finally:
        if connection:
            cursor.close()
            connection.close()

validate_database()
